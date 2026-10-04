import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { submit } from '@/offline/mutate'
import { deleteWithUndo, toast } from '@/store/toasts'
import { d, type NumericInput } from '@/domain/money'
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
  if (key[1] === 'cards') {
    // a card's activity: anything on or into its balances from the statement start on
    const ids = String(key[3] ?? '').split(',')
    const date = row.date as string | undefined
    return (!date || date >= String(key[2])) && (ids.includes(row.sub_account_id as string) || ids.includes(row.to_sub_account_id as string))
  }
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
    // named transaction lists other than Cloud interest and card activity (payee suggestions) have their
    // own shape or filter: leave them to the refetch instead of merging rows in as if by date
    if (table === 'transactions' && typeof key[1] === 'string' && key[1] !== 'yield' && key[1] !== 'cards' && !/^\d{4}-\d{2}-\d{2}$/.test(key[1])) continue
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

interface Cascade {
  table: TableName
  /** cached rows to take off (and put back on) the screens */
  rows: AnyRow[]
  /** the money movements whose balance effect goes with them: worked out from the debt and repayment
   *  records (always loaded), since the transactions themselves may be in a month not loaded yet */
  balance?: Partial<Transaction>[]
}

/** Every cached row of a table, from all its list caches (transactions are cached per date range). */
function cachedRows(qc: QueryClient, table: TableName): AnyRow[] {
  const seen = new Map<unknown, AnyRow>()
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: [table] })) if (Array.isArray(data)) for (const r of data as AnyRow[]) seen.set(r.id, r)
  return [...seen.values()]
}

/**
 * Rows the database removes along with a deleted row, which the screens must stop counting at once
 * (and, for transactions, whose balance effect must be reversed): an account's balances, a debt's
 * repayments and money movements, a repayment's money movement, a contact's debts.
 */
function cascadeRows(qc: QueryClient, table: TableName, row: AnyRow): Cascade[] {
  if (table === 'accounts') return [{ table: 'sub_accounts', rows: cachedRows(qc, 'sub_accounts').filter((s) => s.account_id === row.id) }]
  const debtCascade = (debtIds: Set<unknown>, extraDebts: AnyRow[] = []): Cascade[] => {
    const debts = new Map<unknown, AnyRow>([...extraDebts, ...cachedRows(qc, 'debts')].filter((x) => debtIds.has(x.id)).map((x) => [x.id, x]))
    const payments = cachedRows(qc, 'debt_payments').filter((p) => debtIds.has(p.debt_id))
    const balance: Partial<Transaction>[] = []
    for (const x of debts.values())
      if (x.transaction_id && x.sub_account_id)
        balance.push({ id: x.transaction_id as string, type: x.direction === 'i_owe' ? 'income' : 'expense', amount: x.amount as number, sub_account_id: x.sub_account_id as string })
    for (const p of payments) balance.push(...paymentMovement(p, debts.get(p.debt_id)))
    const txIds = new Set<unknown>(balance.map((b) => b.id))
    const txs = cachedRows(qc, 'transactions').filter((t) => txIds.has(t.id) || (t.source === 'debt' && debtIds.has(t.source_id)))
    return [
      { table: 'debt_payments', rows: payments },
      { table: 'transactions', rows: txs, balance },
    ]
  }
  const paymentMovement = (p: AnyRow, debt: AnyRow | undefined): Partial<Transaction>[] =>
    p.transaction_id && p.sub_account_id && debt
      ? [{ id: p.transaction_id as string, type: debt.direction === 'owed_to_me' ? 'income' : 'expense', amount: p.amount as number, sub_account_id: p.sub_account_id as string }]
      : []
  if (table === 'debts') return debtCascade(new Set([row.id]), [row])
  if (table === 'contacts') {
    const debts = cachedRows(qc, 'debts').filter((x) => x.contact_id === row.id)
    return [{ table: 'debts', rows: debts }, ...debtCascade(new Set(debts.map((x) => x.id)))]
  }
  if (table === 'debt_payments' && row.transaction_id) {
    const debt = cachedRows(qc, 'debts').find((x) => x.id === row.debt_id)
    return [{ table: 'transactions', rows: cachedRows(qc, 'transactions').filter((t) => t.id === row.transaction_id), balance: paymentMovement(row, debt) }]
  }
  return []
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
  contacts: ['debts', 'debt_payments', 'transactions', 'sub_accounts', 'recurring_debts'],
  recurring_debts: ['debts'], // the debts it added stop pointing at it
  accounts: [
    'sub_accounts',
    'transactions',
    'certificates',
    'certificate_payouts',
    'holdings',
    'holding_sales',
    'card_installment_plans',
    'recurring_transactions',
    'recurring_debts',
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
    'recurring_debts',
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

/** Whether a transaction is in any cached transaction list (e.g. it came back with a refetch). */
function txCached(qc: QueryClient, id: string): boolean {
  return qc.getQueriesData<unknown>({ queryKey: ['transactions'] }).some(([, data]) => Array.isArray(data) && (data as AnyRow[]).some((r) => r.id === id))
}

/** Put deleted rows back after Undo or a refused delete, without counting anything twice. */
function restoreRows(qc: QueryClient, table: TableName, row: AnyRow, cascade: Cascade[]) {
  cacheUpsert(qc, table, [row])
  for (const c of cascade) {
    if (c.table === 'transactions') {
      // a refetch in the meantime may already have brought a transaction (and its balance effect) back
      const effects = (c.balance ?? c.rows).filter((t) => !txCached(qc, t.id as string))
      const missing = c.rows.filter((t) => !txCached(qc, t.id))
      for (const t of effects) cacheApplyBalance(qc, t as Partial<Transaction>, 1)
      if (missing.length) cacheUpsert(qc, 'transactions', missing)
    } else if (c.rows.length) cacheUpsert(qc, c.table, c.rows)
  }
}

/** Delete any row after a 6-second undo window (optimistic removal, restored on undo). */
export function useUndoableDelete<T extends TableName>(table: T, opts: { invalidate?: TableName[]; label?: string } = {}) {
  const qc = useQueryClient()
  return (row: Row<T>, message = `${opts.label ?? 'Item'} deleted`) => {
    const r = row as unknown as AnyRow
    // what the database removes along with it (an account's balances, a debt's money movements…) leaves
    // the screens now, not when the undo window ends
    const cascade = cascadeRows(qc, table, r)
    const restore = () => {
      restoreRows(qc, table, r, cascade)
      invalidateRelated(qc, table, RELATED_ON_DELETE, opts.invalidate)
    }
    deleteWithUndo({
      message,
      apply: () => {
        for (const t of new Set<TableName>([table, ...cascade.map((c) => c.table)])) void qc.cancelQueries({ queryKey: [t] })
        if (cascade.some((c) => c.table === 'transactions')) void qc.cancelQueries({ queryKey: ['sub_accounts'] })
        cacheRemove(qc, table, [r.id])
        for (const c of cascade) {
          if (c.table === 'transactions') for (const t of c.balance ?? c.rows) cacheApplyBalance(qc, t as Partial<Transaction>, -1)
          if (c.rows.length) cacheRemove(qc, c.table, c.rows.map((x) => x.id))
        }
      },
      revert: restore,
      commit: async () => {
        try {
          const res = await submit({ kind: 'delete', table, ids: [r.id] })
          notifyQueued(res.queued)
        } catch (err) {
          restoreRows(qc, table, r, cascade)
          reportError(err)
        } finally {
          invalidateRelated(qc, table, RELATED_ON_DELETE, opts.invalidate)
        }
      },
    })
  }
}

/**
 * Set a balance to exactly what it is now (set_sub_account_balance). On a normal balance the
 * difference goes into the opening balance; on a Cloud it is a dated "Balance correction" entry, so
 * interest for past days is not recalculated. Exact even if another device changed the balance
 * meanwhile or the change waits in the offline queue.
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
      cacheUpsert(qc, 'sub_accounts', [
        current.yield_rate != null
          ? { id: sub.id, balance: d(balance).toNumber() }
          : { id: sub.id, balance: d(balance).toNumber(), opening_balance: d(current.opening_balance).plus(shift).toNumber() },
      ])
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => invalidateRelated(qc, 'sub_accounts', RELATED_ON_WRITE, ['transactions']),
  })
}

/** Transaction delete with undo; keeps balances in step. */
export function useUndoableDeleteTransaction() {
  const qc = useQueryClient()
  return (tx: Transaction) => {
    const row = tx as unknown as AnyRow
    // deleting a debt repayment, sale deposit or plan purchase also changes those records on the server
    const restore = () => {
      if (!txCached(qc, tx.id)) {
        cacheApplyBalance(qc, tx, 1)
        cacheUpsert(qc, 'transactions', [row])
      }
    }
    deleteWithUndo({
      message: 'Transaction deleted',
      apply: () => {
        void qc.cancelQueries({ queryKey: ['transactions'] })
        void qc.cancelQueries({ queryKey: ['sub_accounts'] })
        cacheApplyBalance(qc, tx, -1)
        cacheRemove(qc, 'transactions', [tx.id])
      },
      revert: () => {
        restore()
        invalidateRelated(qc, 'transactions', RELATED_ON_DELETE)
      },
      commit: async () => {
        try {
          const res = await submit({ kind: 'delete', table: 'transactions', ids: [tx.id] })
          notifyQueued(res.queued)
        } catch (err) {
          restore()
          reportError(err)
        } finally {
          invalidateRelated(qc, 'transactions', RELATED_ON_DELETE)
        }
      },
    })
  }
}

/** Snapshot every list cache of these tables, to put back if a change is refused. */
function snapshot(qc: QueryClient, tables: TableName[]) {
  return tables.flatMap((t) => qc.getQueriesData<unknown>({ queryKey: [t] }))
}

/**
 * Record a debt repayment (record_debt_payment) and show it at once: the payment, its money
 * movement and the balance change appear immediately, also offline, so the remaining amount and
 * the overpayment check are right for the next payment. Pass the same ids when retrying.
 */
export function useRecordDebtPayment() {
  const qc = useQueryClient()
  const tables: TableName[] = ['debt_payments', 'transactions', 'sub_accounts', 'debts']
  return useMutation({
    mutationFn: async (input: {
      debt: { id: string; direction: 'i_owe' | 'owed_to_me'; currency: string; contactName?: string | null }
      amount: string
      date: string
      subAccountId: string | null
      notes: string | null
      paymentId: string
      transactionId: string
    }) =>
      submit({
        kind: 'rpc',
        fn: 'record_debt_payment',
        args: {
          p_debt_id: input.debt.id,
          p_amount: input.amount,
          p_date: input.date,
          p_sub_account_id: input.subAccountId,
          p_notes: input.notes,
          p_payment_id: input.paymentId,
          p_transaction_id: input.transactionId,
        },
      }),
    onMutate: async (input) => {
      await Promise.all(tables.map((t) => qc.cancelQueries({ queryKey: [t] })))
      const prev = snapshot(qc, tables)
      const txId = input.subAccountId ? input.transactionId : null
      cacheUpsert(qc, 'debt_payments', [
        { id: input.paymentId, debt_id: input.debt.id, amount: input.amount, date: input.date, sub_account_id: input.subAccountId, transaction_id: txId, notes: input.notes },
      ])
      if (txId) {
        const tx = {
          id: txId,
          type: input.debt.direction === 'owed_to_me' ? 'income' : 'expense',
          date: input.date,
          amount: input.amount,
          currency: input.debt.currency,
          sub_account_id: input.subAccountId,
          category_id: null,
          tags: [],
          notes: `${input.debt.direction === 'owed_to_me' ? 'Repayment from' : 'Repayment to'} ${input.debt.contactName ?? ''}`.trim(),
          payee: input.debt.contactName ?? null,
          to_sub_account_id: null,
          to_amount: null,
          to_currency: null,
          source: 'debt',
          source_id: input.debt.id,
        } as const
        cacheApplyBalance(qc, tx as unknown as Partial<Transaction>, 1)
        cacheUpsert(qc, 'transactions', [tx as unknown as AnyRow])
      }
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => tables.forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
  })
}

/**
 * Sell units of a holding (sell_holding) and show it at once: fewer units, the sale in the history
 * and the money in the receiving balance appear immediately, also offline, so a second sale or an
 * edit is checked against what is really left. Pass the same ids when retrying.
 */
export function useSellHolding() {
  const qc = useQueryClient()
  const tables: TableName[] = ['holdings', 'holding_sales', 'transactions', 'sub_accounts']
  return useMutation({
    mutationFn: async (input: {
      holding: { id: string; name: string; units: NumericInput; avg_cost: NumericInput; currency: string; bought_at: string | null }
      units: string
      price: string
      fees: string
      date: string
      subAccountId: string | null
      notes: string | null
      saleId: string
      transactionId: string
    }) =>
      submit({
        kind: 'rpc',
        fn: 'sell_holding',
        args: {
          p_holding_id: input.holding.id,
          p_units: input.units,
          p_price: input.price,
          p_date: input.date,
          p_fees: input.fees,
          p_sub_account_id: input.subAccountId,
          p_notes: input.notes,
          p_sale_id: input.saleId,
          p_transaction_id: input.transactionId,
        },
      }),
    onMutate: async (input) => {
      await Promise.all(tables.map((t) => qc.cancelQueries({ queryKey: [t] })))
      const prev = snapshot(qc, tables)
      const h = input.holding
      const left = d(h.units).minus(d(input.units))
      const cost = d(h.avg_cost).times(d(input.units)).toDecimalPlaces(4)
      const proceeds = d(input.units).times(d(input.price)).minus(d(input.fees)).toDecimalPlaces(4)
      const txId = input.subAccountId && proceeds.gt(0) ? input.transactionId : null
      cacheUpsert(qc, 'holdings', [{ id: h.id, units: left.toNumber(), closed_at: left.isZero() ? input.date : null }])
      cacheUpsert(qc, 'holding_sales', [
        {
          id: input.saleId,
          holding_id: h.id,
          date: input.date,
          units: input.units,
          sell_price: input.price,
          fees: input.fees,
          avg_cost: h.avg_cost,
          cost_basis: cost.toNumber(),
          proceeds: proceeds.toNumber(),
          realized: proceeds.minus(cost).toNumber(),
          currency: h.currency,
          bought_at: h.bought_at,
          sub_account_id: txId ? input.subAccountId : null,
          transaction_id: txId,
          notes: input.notes,
        },
      ])
      if (txId) {
        const tx = {
          id: txId,
          type: 'income',
          date: input.date,
          amount: proceeds.toNumber(),
          currency: h.currency,
          sub_account_id: input.subAccountId,
          category_id: null,
          tags: [],
          notes: `Sold ${d(input.units).toString()} ${h.name}`,
          payee: h.name,
          to_sub_account_id: null,
          to_amount: null,
          to_currency: null,
          source: 'investment',
          source_id: h.id,
        } as const
        cacheApplyBalance(qc, tx as unknown as Partial<Transaction>, 1)
        cacheUpsert(qc, 'transactions', [tx as unknown as AnyRow])
      }
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => tables.forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
  })
}

/** The server answered that a database function doesn't exist (its migration hasn't been run yet). */
function missingFunction(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'PGRST202'
}

/**
 * A new debt in one step (create_debt): the person if new, the money movement when an account is
 * given, and the debt itself, saved together by the server. Shown at once (also offline); pass the
 * same ids when retrying.
 */
export function useCreateDebt() {
  const qc = useQueryClient()
  const tables: TableName[] = ['contacts', 'debts', 'transactions', 'sub_accounts']
  return useMutation({
    mutationFn: async (d: {
      id: string
      contactId: string
      newContactName: string | null
      contactName: string
      direction: 'i_owe' | 'owed_to_me'
      amount: string
      currency: string
      date: string
      dueDate: string | null
      reason: string | null
      notes: string | null
      planCount: number | null
      planAmount: string | null
      planFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
      planStartDate: string | null
      subAccountId: string | null
      transactionId: string
    }) => {
      try {
        return await submit({
          kind: 'rpc',
          fn: 'create_debt',
          args: {
            p_id: d.id,
            p_contact_id: d.contactId,
            p_new_contact_name: d.newContactName,
            p_direction: d.direction,
            p_amount: d.amount,
            p_currency: d.currency,
            p_date: d.date,
            p_due_date: d.dueDate,
            p_reason: d.reason,
            p_notes: d.notes,
            p_plan_count: d.planCount,
            p_plan_amount: d.planAmount,
            p_plan_frequency: d.planFrequency,
            p_plan_start_date: d.planStartDate,
            p_sub_account_id: d.subAccountId,
            p_transaction_id: d.subAccountId ? d.transactionId : null,
          },
        })
      } catch (err) {
        if (!missingFunction(err)) throw err
        // the database doesn't have the one-step save yet (migration 0015): save it the older way, step by step
        let queued = false
        if (d.newContactName) queued = (await submit({ kind: 'upsert', table: 'contacts', rows: [{ id: d.contactId, name: d.newContactName }] })).queued || queued
        if (d.subAccountId) {
          const tx = {
            id: d.transactionId,
            type: d.direction === 'i_owe' ? 'income' : 'expense',
            date: d.date,
            amount: d.amount,
            currency: d.currency,
            sub_account_id: d.subAccountId,
            notes: `${d.direction === 'i_owe' ? 'Borrowed from' : 'Lent to'} ${d.contactName}`,
            payee: d.contactName,
            source: 'debt',
            source_id: d.id,
          }
          queued = (await submit({ kind: 'upsert', table: 'transactions', rows: [tx as Insert<'transactions'>] })).queued || queued
        }
        const debt = {
          id: d.id,
          contact_id: d.contactId,
          direction: d.direction,
          amount: d.amount,
          currency: d.currency,
          date: d.date,
          due_date: d.dueDate,
          reason: d.reason,
          notes: d.notes,
          plan_count: d.planCount,
          plan_amount: d.planAmount,
          plan_frequency: d.planFrequency,
          plan_start_date: d.planStartDate,
          sub_account_id: d.subAccountId,
          transaction_id: d.subAccountId ? d.transactionId : null,
        }
        queued = (await submit({ kind: 'upsert', table: 'debts', rows: [debt as Insert<'debts'>] })).queued || queued
        return { queued }
      }
    },
    onMutate: async (d) => {
      await Promise.all(tables.map((t) => qc.cancelQueries({ queryKey: [t] })))
      const prev = snapshot(qc, tables)
      if (d.newContactName) cacheUpsert(qc, 'contacts', [{ id: d.contactId, name: d.newContactName }])
      if (d.subAccountId) {
        const tx = {
          id: d.transactionId,
          type: d.direction === 'i_owe' ? 'income' : 'expense',
          date: d.date,
          amount: d.amount,
          currency: d.currency,
          sub_account_id: d.subAccountId,
          category_id: null,
          tags: [],
          notes: `${d.direction === 'i_owe' ? 'Borrowed from' : 'Lent to'} ${d.contactName}`,
          payee: d.contactName,
          to_sub_account_id: null,
          to_amount: null,
          to_currency: null,
          source: 'debt',
          source_id: d.id,
        } as const
        cacheApplyBalance(qc, tx as unknown as Partial<Transaction>, 1)
        cacheUpsert(qc, 'transactions', [tx as unknown as AnyRow])
      }
      cacheUpsert(qc, 'debts', [
        {
          id: d.id,
          contact_id: d.contactId,
          direction: d.direction,
          amount: d.amount,
          currency: d.currency,
          date: d.date,
          due_date: d.dueDate,
          reason: d.reason,
          notes: d.notes,
          plan_count: d.planCount,
          plan_amount: d.planAmount,
          plan_frequency: d.planFrequency,
          plan_start_date: d.planStartDate,
          sub_account_id: d.subAccountId,
          transaction_id: d.subAccountId ? d.transactionId : null,
          status: 'open',
        },
      ])
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => [...tables, 'debt_payments' as TableName].forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
  })
}

/**
 * Link a debt's money movement to a balance, move it to another balance, or take it off
 * (set_debt_account, one step). Without it a debt counts in net worth while no balance moved, so net
 * worth jumps by the whole amount. The balance change shows at once (also offline); pass the same
 * transaction id when retrying.
 */
export function useSetDebtAccount() {
  const qc = useQueryClient()
  const tables: TableName[] = ['debts', 'transactions', 'sub_accounts']
  return useMutation({
    mutationFn: async (input: {
      debt: { id: string; direction: 'i_owe' | 'owed_to_me'; amount: NumericInput; currency: string; date: string; transaction_id: string | null; sub_account_id: string | null }
      /** what the existing money movement moves now, if the amount was just edited (default: the debt's amount) */
      linkedAmount?: NumericInput
      contactName: string
      /** the balance the money moved in, or null to take the money movement off */
      subAccountId: string | null
      /** id for a new money movement (ignored when the debt already has one) */
      transactionId: string
    }) => {
      const { debt } = input
      try {
        return await submit({ kind: 'rpc', fn: 'set_debt_account', args: { p_debt_id: debt.id, p_sub_account_id: input.subAccountId, p_transaction_id: input.transactionId } })
      } catch (err) {
        if (!missingFunction(err)) throw err
        // the database doesn't have the one-step change yet (migration 0016): the older way, step by step
        let queued = false
        if (!input.subAccountId) {
          if (debt.transaction_id) queued = (await submit({ kind: 'delete', table: 'transactions', ids: [debt.transaction_id] })).queued || queued
          queued = (await submit({ kind: 'update', table: 'debts', id: debt.id, patch: { sub_account_id: null, transaction_id: null } as Insert<'debts'> })).queued || queued
        } else if (debt.transaction_id) {
          queued = (await submit({ kind: 'update', table: 'transactions', id: debt.transaction_id, patch: { sub_account_id: input.subAccountId } as Insert<'transactions'> })).queued || queued
          queued = (await submit({ kind: 'update', table: 'debts', id: debt.id, patch: { sub_account_id: input.subAccountId } as Insert<'debts'> })).queued || queued
        } else {
          const tx = debtMovement(input)
          queued = (await submit({ kind: 'upsert', table: 'transactions', rows: [tx as unknown as Insert<'transactions'>] })).queued || queued
          queued = (await submit({ kind: 'update', table: 'debts', id: debt.id, patch: { sub_account_id: input.subAccountId, transaction_id: input.transactionId } as Insert<'debts'> })).queued || queued
        }
        return { queued }
      }
    },
    onMutate: async (input) => {
      await Promise.all(tables.map((t) => qc.cancelQueries({ queryKey: [t] })))
      const prev = snapshot(qc, tables)
      const { debt } = input
      const type = debt.direction === 'i_owe' ? 'income' : 'expense'
      // the old movement's effect on its balance goes ...
      if (debt.transaction_id && debt.sub_account_id) cacheApplyBalance(qc, { type, amount: (input.linkedAmount ?? debt.amount) as number, sub_account_id: debt.sub_account_id }, -1)
      if (input.subAccountId) {
        // ... and lands on the chosen balance
        const tx = debtMovement({ ...input, transactionId: debt.transaction_id ?? input.transactionId })
        cacheApplyBalance(qc, tx as unknown as Partial<Transaction>, 1)
        const cached = cachedRows(qc, 'transactions').find((t) => t.id === tx.id)
        cacheUpsert(qc, 'transactions', [cached ? { ...cached, sub_account_id: input.subAccountId } : (tx as unknown as AnyRow)])
        cacheUpsert(qc, 'debts', [{ id: debt.id, sub_account_id: input.subAccountId, transaction_id: tx.id }])
      } else {
        if (debt.transaction_id) cacheRemove(qc, 'transactions', [debt.transaction_id])
        cacheUpsert(qc, 'debts', [{ id: debt.id, sub_account_id: null, transaction_id: null }])
      }
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => tables.forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
  })
}

/** The money movement of a debt (what create_debt and set_debt_account record), as a transaction row. */
function debtMovement(input: {
  debt: { id: string; direction: 'i_owe' | 'owed_to_me'; amount: NumericInput; currency: string; date: string }
  contactName: string
  subAccountId: string | null
  transactionId: string
}) {
  const { debt } = input
  return {
    id: input.transactionId,
    type: debt.direction === 'i_owe' ? 'income' : 'expense',
    date: debt.date,
    amount: debt.amount,
    currency: debt.currency,
    sub_account_id: input.subAccountId,
    category_id: null,
    tags: [],
    notes: `${debt.direction === 'i_owe' ? 'Borrowed from' : 'Lent to'} ${input.contactName}`.trim(),
    payee: input.contactName || null,
    to_sub_account_id: null,
    to_amount: null,
    to_currency: null,
    source: 'debt',
    source_id: debt.id,
  } as const
}

/**
 * An installment purchase on a card in one step (create_installment_purchase): the purchase, its
 * interest / fees and the plan, saved together. Shown at once (also offline); same ids on retry.
 */
export function useCreateInstallmentPurchase() {
  const qc = useQueryClient()
  const tables: TableName[] = ['transactions', 'sub_accounts', 'card_installment_plans']
  return useMutation({
    mutationFn: async (p: {
      planId: string
      purchaseTxId: string
      feeTxId: string
      subAccountId: string
      accountId: string
      currency: string
      description: string
      categoryId: string | null
      feeCategoryId: string | null
      principal: string
      fees: string
      months: number
      purchaseDate: string
      firstBillingDate: string
      purchaseNotes: string | null
    }) => {
      const hasFee = d(p.fees).gt(0)
      try {
        return await submit({
          kind: 'rpc',
          fn: 'create_installment_purchase',
          args: {
            p_plan_id: p.planId,
            p_purchase_tx_id: p.purchaseTxId,
            p_fee_tx_id: hasFee ? p.feeTxId : null,
            p_sub_account_id: p.subAccountId,
            p_description: p.description,
            p_category_id: p.categoryId,
            p_fee_category_id: p.feeCategoryId,
            p_principal: p.principal,
            p_fees: p.fees,
            p_months: p.months,
            p_purchase_date: p.purchaseDate,
            p_first_billing_date: p.firstBillingDate,
            p_purchase_notes: p.purchaseNotes,
          },
        })
      } catch (err) {
        if (!missingFunction(err)) throw err
        // the database doesn't have the one-step save yet (migration 0015): save it the older way, step by step
        const base = { type: 'expense', date: p.purchaseDate, currency: p.currency, sub_account_id: p.subAccountId, source: 'manual' }
        let queued = (
          await submit({
            kind: 'upsert',
            table: 'transactions',
            rows: [{ ...base, id: p.purchaseTxId, amount: p.principal, category_id: p.categoryId, payee: p.description, notes: p.purchaseNotes } as Insert<'transactions'>],
          })
        ).queued
        if (hasFee)
          queued =
            (
              await submit({
                kind: 'upsert',
                table: 'transactions',
                rows: [{ ...base, id: p.feeTxId, amount: p.fees, category_id: p.feeCategoryId, payee: `${p.description} · installment interest & fees` } as Insert<'transactions'>],
              })
            ).queued || queued
        const plan = {
          id: p.planId,
          account_id: p.accountId,
          sub_account_id: p.subAccountId,
          transaction_id: p.purchaseTxId,
          fees_transaction_id: hasFee ? p.feeTxId : null,
          description: p.description,
          currency: p.currency,
          principal: p.principal,
          fees: p.fees,
          months: p.months,
          purchase_date: p.purchaseDate,
          first_billing_date: p.firstBillingDate,
        }
        queued = (await submit({ kind: 'upsert', table: 'card_installment_plans', rows: [plan as Insert<'card_installment_plans'>] })).queued || queued
        return { queued }
      }
    },
    onMutate: async (p) => {
      await Promise.all(tables.map((t) => qc.cancelQueries({ queryKey: [t] })))
      const prev = snapshot(qc, tables)
      const base = { type: 'expense', date: p.purchaseDate, currency: p.currency, sub_account_id: p.subAccountId, tags: [], to_sub_account_id: null, to_amount: null, to_currency: null, source: 'manual', source_id: null }
      const rows: AnyRow[] = [{ ...base, id: p.purchaseTxId, amount: p.principal, category_id: p.categoryId, payee: p.description, notes: p.purchaseNotes } as unknown as AnyRow]
      if (d(p.fees).gt(0)) rows.push({ ...base, id: p.feeTxId, amount: p.fees, category_id: p.feeCategoryId, payee: `${p.description} · installment interest & fees`, notes: null } as unknown as AnyRow)
      for (const r of rows) cacheApplyBalance(qc, r as unknown as Partial<Transaction>, 1)
      cacheUpsert(qc, 'transactions', rows)
      cacheUpsert(qc, 'card_installment_plans', [
        {
          id: p.planId,
          account_id: p.accountId,
          sub_account_id: p.subAccountId,
          transaction_id: p.purchaseTxId,
          fees_transaction_id: d(p.fees).gt(0) ? p.feeTxId : null,
          description: p.description,
          currency: p.currency,
          principal: p.principal,
          fees: p.fees,
          months: p.months,
          purchase_date: p.purchaseDate,
          first_billing_date: p.firstBillingDate,
          closed_at: null,
        },
      ])
      return { prev }
    },
    onError: (err, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      reportError(err)
    },
    onSuccess: (res) => notifyQueued(res.queued),
    onSettled: () => tables.forEach((t) => void qc.invalidateQueries({ queryKey: [t] })),
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
