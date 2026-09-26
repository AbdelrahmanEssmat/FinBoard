import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { submit } from '@/offline/mutate'
import { deleteWithUndo, toast } from '@/store/toasts'
import { d } from '@/domain/money'
import type { Insert, Row, SubAccount, TableName, Transaction } from '@/api/database.types'

type AnyRow = { id: string } & Record<string, unknown>

/** Identity of a cached row: currencies are keyed by code and settings by user; everything else by id. */
function rowKey(table: TableName, row: Record<string, unknown>): unknown {
  if (table === 'currencies') return row.code
  if (table === 'settings') return row.user_id
  return row.id
}

/**
 * Whether a row belongs in a cached query. Transactions are cached per date range
 * (['transactions', from, to]) and for Cloud interest (['transactions', 'yield']); other
 * tables have a single list. `undefined` means "no constraint".
 */
export function rowFitsQuery(table: TableName, key: readonly unknown[], row: AnyRow): boolean | undefined {
  if (table !== 'transactions') return undefined
  if (key[1] === 'yield') return row.source === 'yield'
  const date = row.date as string | undefined
  if (!date) return undefined
  const from = key[1] as string | null | undefined
  const to = key[2] as string | null | undefined
  return (!from || date >= from) && (!to || date <= to)
}

/**
 * Merge rows into every cached list for a table. Rows are only added to (and are removed
 * from) lists whose date range they fall in. Non-list caches (e.g. the settings object) are left alone.
 */
export function cacheUpsert(qc: QueryClient, table: TableName, rows: AnyRow[]) {
  const caches = qc.getQueriesData<unknown>({ queryKey: [table] })
  // the full current version of each row from any cached list, so a partial change that moves a
  // row into another list (e.g. a new date) carries all of its fields with it
  const known = new Map<unknown, AnyRow>()
  for (const [, data] of caches) if (Array.isArray(data)) for (const r of data as AnyRow[]) known.set(rowKey(table, r), r)
  for (const [key, old] of caches) {
    if (old !== undefined && !Array.isArray(old)) continue
    const list = [...((old as AnyRow[] | undefined) ?? [])]
    for (const row of rows) {
      const i = list.findIndex((r) => rowKey(table, r) === rowKey(table, row))
      const merged = { ...(i >= 0 ? list[i] : known.get(rowKey(table, row))), ...row } as AnyRow
      const fits = rowFitsQuery(table, key, merged)
      if (i >= 0) {
        if (fits === false) list.splice(i, 1)
        else list[i] = merged
      } else if (fits !== false) list.unshift(merged)
    }
    qc.setQueryData(key, list)
  }
}

export function cacheRemove(qc: QueryClient, table: TableName, ids: string[]) {
  qc.setQueriesData<unknown>({ queryKey: [table] }, (old: unknown) => (Array.isArray(old) ? (old as AnyRow[]).filter((r) => !ids.includes(r.id)) : old))
}

/** Optimistically mirror the SQL balance trigger for a transaction. */
export function cacheApplyBalance(qc: QueryClient, tx: Partial<Transaction>, sign: 1 | -1) {
  qc.setQueriesData<SubAccount[]>({ queryKey: ['sub_accounts'] }, (old) => {
    if (!old) return old
    return old.map((s) => {
      let delta = d(0)
      if (tx.type === 'income' && s.id === tx.sub_account_id) delta = d(tx.amount)
      if (tx.type === 'expense' && s.id === tx.sub_account_id) delta = d(tx.amount).neg()
      if (tx.type === 'transfer') {
        if (s.id === tx.sub_account_id) delta = delta.minus(d(tx.amount))
        if (s.id === tx.to_sub_account_id) delta = delta.plus(d(tx.to_amount))
      }
      if (delta.isZero()) return s
      return { ...s, balance: d(s.balance).plus(delta.times(sign)).toNumber() }
    })
  })
}

function notifyQueued(queued: boolean) {
  if (queued) toast.info('Saved offline. Will sync when back online.')
}

function reportError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  toast.error(msg.length > 140 ? 'Something went wrong. Please try again.' : msg)
}

/** Generic upsert for any table with optimistic cache merge. */
export function useUpsert<T extends TableName>(table: T, opts: { invalidate?: TableName[]; silent?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Insert<T>[]) => submit({ kind: 'upsert', table, rows: rows as Insert<TableName>[] }),
    onMutate: async (rows) => {
      await qc.cancelQueries({ queryKey: [table] })
      const prev = qc.getQueriesData<AnyRow[]>({ queryKey: [table] })
      cacheUpsert(qc, table, rows.filter((r) => (r as AnyRow).id) as AnyRow[])
      return { prev }
    },
    onError: (err, _rows, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => {
      if (!opts.silent) notifyQueued(res.queued)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [table] })
      opts.invalidate?.forEach((t) => void qc.invalidateQueries({ queryKey: [t] }))
    },
  })
}

/** Generic delete with optimistic removal. */
/**
 * Change only some columns of existing rows (`{ id, ...changedColumns }`). Use this instead of
 * useUpsert for partial edits: an upsert must satisfy every NOT NULL column even when the row exists.
 */
export function useUpdateRows<T extends TableName>(table: T, opts: { invalidate?: TableName[]; silent?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patches: ({ id: string } & Insert<T>)[]) => {
      let queued = false
      for (const { id, ...patch } of patches) {
        const res = await submit({ kind: 'update', table, id, patch: patch as Insert<TableName> })
        queued = queued || res.queued
      }
      return { queued }
    },
    onMutate: async (patches) => {
      await qc.cancelQueries({ queryKey: [table] })
      const prev = qc.getQueriesData<unknown>({ queryKey: [table] })
      cacheUpsert(qc, table, patches as unknown as AnyRow[])
      return { prev }
    },
    onError: (err, _p, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => {
      if (!opts.silent) notifyQueued(res.queued)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [table] })
      opts.invalidate?.forEach((t) => void qc.invalidateQueries({ queryKey: [t] }))
    },
  })
}

export function useDeleteRows<T extends TableName>(table: T, opts: { invalidate?: TableName[] } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => submit({ kind: 'delete', table, ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: [table] })
      const prev = qc.getQueriesData<AnyRow[]>({ queryKey: [table] })
      cacheRemove(qc, table, ids)
      return { prev }
    },
    onError: (err, _ids, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [table] })
      opts.invalidate?.forEach((t) => void qc.invalidateQueries({ queryKey: [t] }))
    },
  })
}

/** Transactions: upsert + optimistic balance changes (mirrors the DB trigger). */
export function useSaveTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { row: Insert<'transactions'> & { id: string }; previous?: Transaction | null }) =>
      submit({ kind: 'upsert', table: 'transactions', rows: [input.row] }),
    onMutate: async ({ row, previous }) => {
      await Promise.all([qc.cancelQueries({ queryKey: ['transactions'] }), qc.cancelQueries({ queryKey: ['sub_accounts'] })])
      const prevTx = qc.getQueriesData<AnyRow[]>({ queryKey: ['transactions'] })
      const prevSub = qc.getQueriesData<AnyRow[]>({ queryKey: ['sub_accounts'] })
      if (previous) cacheApplyBalance(qc, previous, -1)
      cacheApplyBalance(qc, row as Partial<Transaction>, 1)
      cacheUpsert(qc, 'transactions', [row as unknown as AnyRow])
      return { prevTx, prevSub }
    },
    onError: (err, _v, ctx) => {
      ctx?.prevTx.forEach(([k, v]) => qc.setQueryData(k, v))
      ctx?.prevSub.forEach(([k, v]) => qc.setQueryData(k, v))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['transactions'] })
      void qc.invalidateQueries({ queryKey: ['sub_accounts'] })
    },
  })
}

export function useDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tx: Transaction) => submit({ kind: 'delete', table: 'transactions', ids: [tx.id] }),
    onMutate: async (tx) => {
      const prevTx = qc.getQueriesData<AnyRow[]>({ queryKey: ['transactions'] })
      const prevSub = qc.getQueriesData<AnyRow[]>({ queryKey: ['sub_accounts'] })
      cacheApplyBalance(qc, tx, -1)
      cacheRemove(qc, 'transactions', [tx.id])
      return { prevTx, prevSub }
    },
    onError: (err, _v, ctx) => {
      ctx?.prevTx.forEach(([k, v]) => qc.setQueryData(k, v))
      ctx?.prevSub.forEach(([k, v]) => qc.setQueryData(k, v))
      reportError(err)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['transactions'] })
      void qc.invalidateQueries({ queryKey: ['sub_accounts'] })
      void qc.invalidateQueries({ queryKey: ['debt_payments'] })
      void qc.invalidateQueries({ queryKey: ['certificate_payouts'] })
    },
  })
}

/** Delete any row after a 6-second undo window (optimistic removal, restored on undo). */
export function useUndoableDelete<T extends TableName>(table: T, opts: { invalidate?: TableName[]; label?: string } = {}) {
  const qc = useQueryClient()
  return (row: Row<T>, message = `${opts.label ?? 'Item'} deleted`) =>
    deleteWithUndo({
      message,
      apply: () => cacheRemove(qc, table, [(row as unknown as AnyRow).id]),
      revert: () => cacheUpsert(qc, table, [row as unknown as AnyRow]),
      commit: async () => {
        try {
          const res = await submit({ kind: 'delete', table, ids: [(row as unknown as AnyRow).id] })
          notifyQueued(res.queued)
        } catch (err) {
          cacheUpsert(qc, table, [row as unknown as AnyRow])
          reportError(err)
        } finally {
          void qc.invalidateQueries({ queryKey: [table] })
          opts.invalidate?.forEach((t) => void qc.invalidateQueries({ queryKey: [t] }))
        }
      },
    })
}

/** Transaction delete with undo; keeps balances in step. */
export function useUndoableDeleteTransaction() {
  const qc = useQueryClient()
  return (tx: Transaction) =>
    deleteWithUndo({
      message: 'Transaction deleted',
      apply: () => {
        cacheApplyBalance(qc, tx, -1)
        cacheRemove(qc, 'transactions', [tx.id])
      },
      revert: () => {
        cacheApplyBalance(qc, tx, 1)
        cacheUpsert(qc, 'transactions', [tx as unknown as AnyRow])
      },
      commit: async () => {
        try {
          const res = await submit({ kind: 'delete', table: 'transactions', ids: [tx.id] })
          notifyQueued(res.queued)
        } catch (err) {
          cacheApplyBalance(qc, tx, 1)
          cacheUpsert(qc, 'transactions', [tx as unknown as AnyRow])
          reportError(err)
        } finally {
          for (const t of ['transactions', 'sub_accounts', 'debt_payments', 'certificate_payouts'] as TableName[]) void qc.invalidateQueries({ queryKey: [t] })
        }
      },
    })
}

/** Call a Postgres function; queued offline if needed. */
export function useRpc(fn: string, invalidate: TableName[] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: Record<string, unknown>) => submit({ kind: 'rpc', fn, args }),
    onError: reportError,
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => invalidate.forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
  })
}

export type { Row }
