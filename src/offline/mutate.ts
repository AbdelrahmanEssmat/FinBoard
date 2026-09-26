import { supabase, isNetworkError } from '@/api/supabase'
import { enqueue, notify, offlineDb, type OutboxOp } from '@/offline/outbox'

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

export class QueuedOffline extends Error {
  constructor() {
    super('Saved offline. It will sync when you are back online.')
    this.name = 'QueuedOffline'
  }
}

/**
 * Run a mutation now; if the network is down, queue it for later and resolve
 * so the optimistic UI stays in place. Non-network errors are re-thrown.
 */
export async function submit(op: OutboxOp): Promise<{ queued: boolean; data?: unknown }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await enqueue(op)
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

let flushing = false
/** Replay the outbox in order. Stops at the first network failure; drops ops rejected by the server after 5 attempts. */
export async function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return { sent: 0, remaining: await offlineDb.outbox.count() }
  flushing = true
  let sent = 0
  try {
    const entries = await offlineDb.outbox.orderBy('createdAt').toArray()
    for (const entry of entries) {
      try {
        await execute(entry.op)
        await offlineDb.outbox.delete(entry.id!)
        sent++
      } catch (err) {
        if (isNetworkError(err)) break
        const attempts = entry.attempts + 1
        const message = err instanceof Error ? err.message : String(err)
        if (attempts >= 5) {
          console.error('Dropping unsyncable change', entry.op, message)
          await offlineDb.outbox.delete(entry.id!)
        } else {
          await offlineDb.outbox.update(entry.id!, { attempts, lastError: message })
        }
      }
    }
  } finally {
    flushing = false
    notify()
  }
  return { sent, remaining: await offlineDb.outbox.count() }
}
