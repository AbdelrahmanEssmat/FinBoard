import { supabase, isNetworkError } from '@/api/supabase'
import { enqueue, notify, offlineDb, type OutboxOp } from '@/offline/outbox'
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

const MAX_ATTEMPTS = 5

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
  if ((await offlineDb.outbox.count()) > 0) {
    const id = await enqueue(op)
    await flushOutbox()
    const mine = await offlineDb.outbox.get(id)
    if (!mine) return { queued: false }
    if (mine.lastError && !mine.networkError) {
      // rejected by the server: take it out of the queue and report it like a direct failure
      await offlineDb.outbox.delete(id)
      notify()
      throw new Error(mine.lastError)
    }
    return { queued: true }
  }
  try {
    const data = await execute(op)
    return { queued: false, data }
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue(op)
      return { queued: true }
    }
    throw err
  }
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null

/**
 * Replay the queue strictly in order. It stops at the first failure so a later change can
 * never overtake an earlier one. A change the server keeps rejecting is discarded after
 * MAX_ATTEMPTS tries, and you are told so.
 */
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    try {
      const entries = await offlineDb.outbox.toArray() // primary-key (insertion) order
      for (const entry of entries) {
        try {
          await execute(entry.op)
          await offlineDb.outbox.delete(entry.id!)
          sent++
        } catch (err) {
          const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
          if (isNetworkError(err)) {
            await offlineDb.outbox.update(entry.id!, { lastError: message, networkError: true })
            break
          }
          const attempts = entry.attempts + 1
          if (attempts >= MAX_ATTEMPTS) {
            await offlineDb.outbox.delete(entry.id!)
            toast.error(`A change made offline could not be saved and was discarded: ${message}`)
            continue
          }
          await offlineDb.outbox.update(entry.id!, { attempts, lastError: message, networkError: false })
          break
        }
      }
    } finally {
      notify()
    }
    return { sent, remaining: await offlineDb.outbox.count() }
  })().finally(() => {
    flushing = null
  })
  return flushing
}
