import { supabase } from '@/api/supabase'
import { queryClient } from '@/api/queryClient'
import { enqueue, myEntries, notify, offlineDb, type OutboxOp } from '@/offline/outbox'
import { classifyError } from '@/offline/errors'
import { isSendingPaused } from '@/offline/session'
import { toast } from '@/store/toasts'

/** Execute one operation against Supabase. Throws on failure. */
export async function execute(op: OutboxOp): Promise<unknown> {
  const db = supabase as any
  switch (op.kind) {
    case 'upsert': {
      const { data, error } = await db.from(op.table).upsert(op.rows).select()
      if (error) throw error
      return data
    }
    case 'update': {
      const { data, error } = await db.from(op.table).update(op.patch).eq('id', op.id).select()
      if (error) throw error
      return data
    }
    case 'delete': {
      const { error } = await db.from(op.table).delete().in('id', op.ids)
      if (error) throw error
      return null
    }
    case 'rpc': {
      const { data, error } = await db.rpc(op.fn, op.args)
      if (error) throw error
      return data
    }
  }
}

/** How often a change the server keeps failing on (without refusing it outright) is retried. */
const MAX_ATTEMPTS = 5

/** Queue entries a live submit() is waiting on, and the refusal it should report instead of a toast. */
const awaiting = new Set<number>()
const rejected = new Map<number, string>()

/**
 * Run a mutation. Changes always reach the server in the order they were made: while older
 * changes are still waiting in the offline queue, a new one joins the queue behind them.
 * If the network is down the change stays queued (the optimistic UI keeps it); if the server
 * rejects it, the error is thrown so the screen can show it and roll back.
 */
export async function submit(op: OutboxOp): Promise<{ queued: boolean; data?: unknown }> {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  if (offline) {
    await enqueue(op)
    return { queued: true }
  }
  if ((await myEntries()).length > 0) {
    const id = await enqueue(op)
    awaiting.add(id)
    try {
      await flushOutbox()
    } finally {
      awaiting.delete(id)
    }
    const mine = await offlineDb.outbox.get(id)
    // still queued: an earlier change is waiting on the network, and this one waits behind it
    if (mine) return { queued: true }
    const refusal = rejected.get(id)
    rejected.delete(id)
    if (refusal) throw new Error(refusal)
    return { queued: false }
  }
  try {
    const data = await execute(op)
    return { queued: false, data }
  } catch (err) {
    if (classifyError(err) === 'network') {
      await enqueue(op)
      return { queued: true }
    }
    throw err
  }
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null

/**
 * Replay the queue strictly in order. It stops at the first network failure so a later change
 * can never overtake an earlier one. A change the server refuses is dropped at once (the screen
 * is refreshed so it no longer shows it); one that keeps failing for other reasons is dropped
 * after MAX_ATTEMPTS tries. Either way you are told.
 */
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    let dropped = false
    if (isSendingPaused()) return { sent: 0, remaining: (await myEntries()).length }
    try {
      // only the signed-in person's changes, in the order they were made
      const entries = await myEntries()
      for (const entry of entries) {
        try {
          await execute(entry.op)
          await offlineDb.outbox.delete(entry.id!)
          sent++
        } catch (err) {
          const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
          const kind = classifyError(err)
          if (kind === 'network') {
            await offlineDb.outbox.update(entry.id!, { lastError: message, networkError: true })
            break
          }
          const attempts = entry.attempts + 1
          if (kind === 'permanent' || attempts >= MAX_ATTEMPTS) {
            await offlineDb.outbox.delete(entry.id!)
            if (awaiting.has(entry.id!)) rejected.set(entry.id!, message)
            else {
              toast.error(`A change could not be saved and was discarded: ${message}`)
              dropped = true
            }
            continue
          }
          await offlineDb.outbox.update(entry.id!, { attempts, lastError: message, networkError: false })
          break
        }
      }
    } finally {
      notify()
      // the screen still shows the dropped change: reload everything from the server
      if (dropped) void queryClient.invalidateQueries()
    }
    return { sent, remaining: (await myEntries()).length }
  })().finally(() => {
    flushing = null
  })
  return flushing
}
