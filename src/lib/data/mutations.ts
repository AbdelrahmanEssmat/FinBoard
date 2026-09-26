import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { submit } from '../offline/mutate'
import { deleteWithUndo, toast } from '../toast'
import { d } from '@/domain/money'
import type { Insert, Row, SubAccount, TableName, Transaction } from '../database.types'

type AnyRow = { id: string } & Record<string, unknown>

/** Merge rows into every cached query for a table (keys starting with the table name). */
export function cacheUpsert(qc: QueryClient, table: TableName, rows: AnyRow[]) {
  qc.setQueriesData<AnyRow[]>({ queryKey: [table] }, (old) => {
    const list = old ? [...old] : []
    for (const row of rows) {
      const i = list.findIndex((r) => r.id === row.id)
      if (i >= 0) list[i] = { ...list[i], ...row }
      else list.unshift(row)
    }
    return list
  })
}

export function cacheRemove(qc: QueryClient, table: TableName, ids: string[]) {
  qc.setQueriesData<AnyRow[]>({ queryKey: [table] }, (old) => (old ? old.filter((r) => !ids.includes(r.id)) : old))
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
