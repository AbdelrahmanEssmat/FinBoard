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
    // named transaction lists other than Cloud interest (payee suggestions, card activity…) have their
    // own shape or filter: leave them to the refetch instead of merging rows in as if by date
    if (table === 'transactions' && typeof key[1] === 'string' && key[1] !== 'yield' && !/^\d{4}-\d{2}-\d{2}$/.test(key[1])) continue
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

/** Rows a delete takes with it that the screens must stop counting at once (an account's balances). */
function cascadeRows(qc: QueryClient, table: TableName, row: AnyRow): { table: TableName; rows: AnyRow[] } | null {
  if (table !== 'accounts') return null
  const subs = qc.getQueryData<AnyRow[]>(['sub_accounts']) ?? []
  return { table: 'sub_accounts', rows: subs.filter((s) => s.account_id === row.id) }
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

/**
 * Tables the database rewrites by trigger or cascade when a row of the key table is deleted
 * (see transactions_cleanup, debts_after_delete and the foreign keys in supabase/migrations).
 */
export const RELATED_ON_DELETE: Partial<Record<TableName, TableName[]>> = {
  transactions: ['sub_accounts', 'debt_payments', 'debts', 'certificate_payouts', 'holdings', 'holding_sales', 'card_installment_plans'],
  debts: ['transactions', 'sub_accounts', 'debt_payments'],
  debt_payments: ['debts', 'transactions', 'sub_accounts'],
  contacts: ['debts', 'debt_payments', 'transactions', 'sub_accounts'],
  accounts: [
    'sub_accounts',
    'transactions',
    'certificates',
    'certificate_payouts',
    'holdings',
    'holding_sales',
    'card_installment_plans',
    'recurring_transactions',
    'debts',
    'debt_payments',
    'accounts',
  ],
  sub_accounts: [
    'transactions',
    'certificates',
    'certificate_payouts',
    'holding_sales',
    'card_installment_plans',
    'recurring_transactions',
    'debts',
    'debt_payments',
  ],
  categories: ['transactions', 'recurring_transactions', 'budgets'],
  certificates: ['certificate_payouts', 'transactions', 'sub_accounts'],
  holdings: ['holding_sales', 'transactions', 'sub_accounts'],
  holding_sales: ['holdings', 'transactions', 'sub_accounts'],
  investment_categories: ['holdings'],
}

/** Tables a trigger rewrites when a row is inserted or updated. */
export const RELATED_ON_WRITE: Partial<Record<TableName, TableName[]>> = {
  debts: ['transactions', 'sub_accounts'], // debts_sync_transaction moves the linked borrow/lend transaction
  certificates: ['certificate_payouts'], // the payout schedule is regenerated
  transactions: ['sub_accounts'], // balances
  sub_accounts: ['transactions'], // yield accrual / opening balance
}

/** Refresh a table and everything the server changes along with it (plus any `extra`). */
export function invalidateRelated(qc: QueryClient, table: TableName, map: Partial<Record<TableName, TableName[]>>, extra?: TableName[]) {
  for (const t of new Set([table, ...(map[table] ?? []), ...(extra ?? [])])) void qc.invalidateQueries({ queryKey: [t] })
}

function notifyQueued(queued: boolean) {
  if (!queued) return
  // online but queued = an earlier change is still waiting for the network; this one follows it
  toast.info(typeof navigator !== 'undefined' && navigator.onLine ? 'Saved. Syncing with the server…' : 'Saved offline. Will sync when back online.')
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
    onSettled: () => invalidateRelated(qc, table, RELATED_ON_WRITE, opts.invalidate),
  })
}

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
    onSettled: () => invalidateRelated(qc, table, RELATED_ON_WRITE, opts.invalidate),
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
    onSettled: () => invalidateRelated(qc, table, RELATED_ON_DELETE, opts.invalidate),
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
    onSettled: () => invalidateRelated(qc, 'transactions', RELATED_ON_DELETE),
  })
}

/** Delete any row after a 6-second undo window (optimistic removal, restored on undo). */
export function useUndoableDelete<T extends TableName>(table: T, opts: { invalidate?: TableName[]; label?: string } = {}) {
  const qc = useQueryClient()
  return (row: Row<T>, message = `${opts.label ?? 'Item'} deleted`) => {
    const r = row as unknown as AnyRow
    // e.g. a deleted account's balances leave the totals now, not when the undo window ends
    const cascade = cascadeRows(qc, table, r)
    const restore = () => {
      cacheUpsert(qc, table, [r])
      if (cascade?.rows.length) cacheUpsert(qc, cascade.table, cascade.rows)
    }
    deleteWithUndo({
      message,
      apply: () => {
        cacheRemove(qc, table, [r.id])
        if (cascade?.rows.length)
          cacheRemove(
            qc,
            cascade.table,
            cascade.rows.map((x) => x.id),
          )
      },
      revert: restore,
      commit: async () => {
        try {
          const res = await submit({ kind: 'delete', table, ids: [r.id] })
          notifyQueued(res.queued)
        } catch (err) {
          restore()
          reportError(err)
        } finally {
          invalidateRelated(qc, table, RELATED_ON_DELETE, opts.invalidate)
        }
      },
    })
  }
}

/**
 * Set a balance to exactly what it is now. The server puts the difference into the opening
 * balance (set_sub_account_balance), so transactions stay as they are and the result is exact
 * even if another device changed the balance meanwhile or the change waits in the offline queue.
 */
export function useSetBalance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ sub, balance }: { sub: SubAccount; balance: string }) =>
      submit({ kind: 'rpc', fn: 'set_sub_account_balance', args: { p_sub_account_id: sub.id, p_balance: balance } }),
    onMutate: async ({ sub, balance }) => {
      await qc.cancelQueries({ queryKey: ['sub_accounts'] })
      const prev = qc.getQueriesData<unknown>({ queryKey: ['sub_accounts'] })
      const current = (qc.getQueryData<SubAccount[]>(['sub_accounts']) ?? []).find((s) => s.id === sub.id) ?? sub
      const shift = d(balance).minus(d(current.balance))
      cacheUpsert(qc, 'sub_accounts', [{ id: sub.id, balance: d(balance).toNumber(), opening_balance: d(current.opening_balance).plus(shift).toNumber() }])
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => invalidateRelated(qc, 'sub_accounts', RELATED_ON_WRITE),
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
          invalidateRelated(qc, 'transactions', RELATED_ON_DELETE)
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
