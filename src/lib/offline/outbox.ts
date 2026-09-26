import Dexie, { type Table } from 'dexie'
import type { TableName, Insert } from '../database.types'

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
}

class OfflineDb extends Dexie {
  outbox!: Table<OutboxEntry, number>
  constructor() {
    super('finance-tracker-offline')
    this.version(1).stores({ outbox: '++id, createdAt' })
  }
}

export const offlineDb = new OfflineDb()

export async function enqueue(op: OutboxOp): Promise<void> {
  await offlineDb.outbox.add({ op, createdAt: Date.now(), attempts: 0 })
  notify()
}

export async function pendingCount(): Promise<number> {
  return offlineDb.outbox.count()
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
