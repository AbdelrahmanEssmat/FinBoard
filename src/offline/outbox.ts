import Dexie, { type Table } from 'dexie'
import type { TableName, Insert } from '@/api/database.types'
import { getCurrentUserId, isMine } from '@/offline/session'

export type OutboxOp =
  | { kind: 'upsert'; table: TableName; rows: Insert<TableName>[] }
  | { kind: 'update'; table: TableName; id: string; patch: Insert<TableName> }
  | { kind: 'delete'; table: TableName; ids: string[] }
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }

export interface OutboxEntry {
  id?: number
  op: OutboxOp
  createdAt: number
  attempts: number
  lastError?: string
  /** true when the last failure was a lost connection (retry later), false when the server rejected it */
  networkError?: boolean
  /** who made the change: it is only ever sent while that person is signed in */
  userId?: string
}

class OfflineDb extends Dexie {
  outbox!: Table<OutboxEntry, number>
  constructor() {
    super('finance-tracker-offline')
    this.version(1).stores({ outbox: '++id, createdAt' })
  }
}

export const offlineDb = new OfflineDb()

/** Adds an operation to the end of the queue and returns its id (ids increase, so they give the replay order). */
export async function enqueue(op: OutboxOp): Promise<number> {
  const id = await offlineDb.outbox.add({ op, createdAt: Date.now(), attempts: 0, userId: getCurrentUserId() ?? undefined })
  notify()
  return id as number
}

/** The signed-in user's queued changes, oldest first (other people's changes on this phone are left alone). */
export async function myEntries(): Promise<OutboxEntry[]> {
  return (await offlineDb.outbox.toArray()).filter((e) => isMine(e.userId))
}

/** Give changes queued before stamping existed to their owner (called before that person signs out). */
export async function stampUnowned(userId: string): Promise<void> {
  await offlineDb.outbox.filter((e) => !e.userId).modify({ userId })
}

export async function pendingCount(): Promise<number> {
  return (await myEntries()).length
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function notify() {
  listeners.forEach((l) => l())
}
