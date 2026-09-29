import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEntry, OutboxOp } from '@/offline/outbox'

// an in-memory outbox (Dexie needs IndexedDB, which node doesn't have)
const store: { rows: OutboxEntry[]; next: number } = { rows: [], next: 1 }
vi.mock('@/offline/outbox', () => ({
  enqueue: async (op: OutboxOp) => {
    const id = store.next++
    store.rows.push({ id, op, createdAt: Date.now(), attempts: 0 })
    return id
  },
  myEntries: async () => [...store.rows],
  notify: () => {},
  offlineDb: {
    outbox: {
      get: async (id: number) => store.rows.find((r) => r.id === id),
      update: async (id: number, patch: Partial<OutboxEntry>) => {
        const r = store.rows.find((x) => x.id === id)
        if (r) Object.assign(r, patch)
      },
      delete: async (id: number) => {
        store.rows = store.rows.filter((r) => r.id !== id)
      },
    },
  },
}))

// the server: each upsert resolves or rejects according to a script keyed by the row id
const outcomes = new Map<string, unknown>()
const upsert = vi.fn(async (rows: { id: string }[]) => {
  const fail = outcomes.get(rows[0]!.id)
  return fail ? { data: null, error: fail } : { data: rows, error: null }
})
vi.mock('@/api/supabase', () => ({
  supabase: { from: () => ({ upsert: (rows: { id: string }[]) => ({ select: () => upsert(rows) }) }) },
  isNetworkError: (err: unknown) => /failed to fetch/i.test(String((err as Error)?.message ?? err)),
}))
const toastError = vi.fn()
vi.mock('@/store/toasts', () => ({ toast: { info: vi.fn(), error: (m: string) => toastError(m) } }))
const invalidate = vi.fn()
vi.mock('@/api/queryClient', () => ({ queryClient: { invalidateQueries: () => invalidate() } }))

import { classifyError } from '@/offline/errors'
import { flushOutbox, submit } from '@/offline/mutate'
import { enqueue } from '@/offline/outbox'

const op = (id: string): OutboxOp => ({ kind: 'upsert', table: 'tags', rows: [{ id, name: id } as never] })

beforeEach(() => {
  store.rows = []
  store.next = 1
  outcomes.clear()
  upsert.mockClear()
  toastError.mockClear()
  invalidate.mockClear()
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
})

describe('classifyError', () => {
  it('tells a lost connection, a refusal and a hiccup apart', () => {
    expect(classifyError(new Error('Failed to fetch'))).toBe('network')
    expect(classifyError({ code: '23505', message: 'duplicate key' })).toBe('permanent')
    expect(classifyError({ code: 'PGRST116', message: 'no rows' })).toBe('permanent')
    expect(classifyError({ status: 403, message: 'forbidden' })).toBe('permanent')
    expect(classifyError(new Error('boom'))).toBe('transient')
    expect(classifyError({ status: 503 })).toBe('transient')
  })
})

describe('flushOutbox', () => {
  it('drops a change the server refuses and carries on with the next one', async () => {
    await enqueue(op('a'))
    await enqueue(op('b'))
    outcomes.set('a', { code: '42501', message: 'permission denied for table tags' })
    const r = await flushOutbox()
    expect(r).toEqual({ sent: 1, remaining: 0 })
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('permission denied'))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
  it('keeps everything when the connection is lost, in order', async () => {
    await enqueue(op('a'))
    await enqueue(op('b'))
    outcomes.set('a', new Error('Failed to fetch'))
    const r = await flushOutbox()
    expect(r).toEqual({ sent: 0, remaining: 2 })
    expect(upsert).toHaveBeenCalledTimes(1) // b was never attempted
    expect(store.rows[0]!.networkError).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })
  it('retries a hiccup a few times before giving up', async () => {
    await enqueue(op('a'))
    outcomes.set('a', new Error('boom'))
    for (let i = 0; i < 4; i++) expect((await flushOutbox()).remaining).toBe(1)
    expect((await flushOutbox()).remaining).toBe(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})

describe('submit', () => {
  it('sends straight away when nothing is queued', async () => {
    expect(await submit(op('a'))).toMatchObject({ queued: false })
    expect(store.rows).toHaveLength(0)
  })
  it('waits behind a change stuck on the network', async () => {
    await enqueue(op('a'))
    outcomes.set('a', new Error('Failed to fetch'))
    expect(await submit(op('b'))).toEqual({ queued: true })
    expect(store.rows.map((r) => (r.op as { rows: { id: string }[] }).rows[0]!.id)).toEqual(['a', 'b'])
  })
  it('goes through once the earlier change is sent, and reports its own refusal without a toast', async () => {
    await enqueue(op('a'))
    expect(await submit(op('b'))).toEqual({ queued: false })
    expect(store.rows).toHaveLength(0)

    await enqueue(op('c'))
    outcomes.set('d', { code: '23514', message: 'violates check constraint' })
    await expect(submit(op('d'))).rejects.toThrow('violates check constraint')
    expect(toastError).not.toHaveBeenCalled() // the form shows the error itself
    expect(store.rows).toHaveLength(0)
  })
})
