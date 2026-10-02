import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import type { Row, TableName, Transaction } from '@/api/database.types'

type OrderSpec = { column: string; ascending?: boolean }

/** Supabase returns at most 1000 rows per request, so everything is read in pages. */
const PAGE = 1000

/**
 * Read all rows (or up to `limit`) in pages. `build` adds filters and ordering; a stable
 * order is required so pages don't overlap.
 */
export async function fetchPaged<T>(build: () => any, limit = Infinity): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; out.length < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1
    const { data, error } = await build().range(from, to)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < to - from + 1) break
  }
  return out
}

function fetchTable<T extends TableName>(table: T, order: OrderSpec[] = [], limit?: number): Promise<Row<T>[]> {
  return fetchPaged<Row<T>>(() => {
    let q: any = supabase.from(table).select('*')
    for (const o of order) q = q.order(o.column, { ascending: o.ascending ?? true })
    return q.order('id', { ascending: true }) // tie-breaker keeps pages stable
  }, limit)
}

/** Primary key used as the stable order when reading a whole table (most tables: id). */
const STABLE_ORDER: Partial<Record<TableName, string>> = { settings: 'user_id', currencies: 'code' }

/** Every row of a table, however many (for backups: a single request would stop at 1000). */
export function fetchAllRows<T extends TableName>(table: T): Promise<Row<T>[]> {
  return fetchPaged<Row<T>>(() => (supabase as any).from(table).select('*').order(STABLE_ORDER[table] ?? 'id', { ascending: true }))
}

function tableQuery<T extends TableName>(table: T, order?: OrderSpec[], limit?: number) {
  return { queryKey: [table] as const, queryFn: () => fetchTable(table, order, limit) }
}

type Opts<T> = Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>

export const useAccounts = (o?: Opts<Row<'accounts'>>) =>
  useQuery({ ...tableQuery('accounts', [{ column: 'sort_order' }, { column: 'created_at' }]), ...o })
/** The devices that receive reminders (this person's). */
export const usePushSubscriptions = (o?: Opts<Row<'push_subscriptions'>>) => useQuery({ ...tableQuery('push_subscriptions', [{ column: 'created_at' }]), ...o })
export const useSubAccounts = (o?: Opts<Row<'sub_accounts'>>) =>
  useQuery({ ...tableQuery('sub_accounts', [{ column: 'sort_order' }, { column: 'created_at' }]), ...o })
export const useCategories = (o?: Opts<Row<'categories'>>) =>
  useQuery({ ...tableQuery('categories', [{ column: 'sort_order' }, { column: 'name' }]), ...o })
export const useTags = (o?: Opts<Row<'tags'>>) => useQuery({ ...tableQuery('tags', [{ column: 'name' }]), ...o })
export const useCurrencies = (o?: Opts<Row<'currencies'>>) =>
  useQuery({
    queryKey: ['currencies'] as const,
    queryFn: () => fetchPaged<Row<'currencies'>>(() => supabase.from('currencies').select('*').order('sort_order').order('code')),
    ...o,
  })
/** Newest rates first; plenty for years of daily history across several currencies. */
export const useRates = (o?: Opts<Row<'exchange_rates'>>) =>
  useQuery({ ...tableQuery('exchange_rates', [{ column: 'rate_date', ascending: false }], 5000), ...o })
export const useCertificates = (o?: Opts<Row<'certificates'>>) =>
  useQuery({ ...tableQuery('certificates', [{ column: 'maturity_date' }]), ...o })
export const usePayouts = (o?: Opts<Row<'certificate_payouts'>>) =>
  useQuery({ ...tableQuery('certificate_payouts', [{ column: 'due_date' }]), ...o })
export const useInvestmentCategories = (o?: Opts<Row<'investment_categories'>>) =>
  useQuery({ ...tableQuery('investment_categories', [{ column: 'sort_order' }]), ...o })
export const useHoldings = (o?: Opts<Row<'holdings'>>) => useQuery({ ...tableQuery('holdings', [{ column: 'name' }]), ...o })
export const useHoldingSales = (o?: Opts<Row<'holding_sales'>>) =>
  useQuery({ ...tableQuery('holding_sales', [{ column: 'date', ascending: false }, { column: 'created_at', ascending: false }]), ...o })
export const useInstallmentPlans = (o?: Opts<Row<'card_installment_plans'>>) =>
  useQuery({ ...tableQuery('card_installment_plans', [{ column: 'purchase_date', ascending: false }]), ...o })
export const useGoldItems = (o?: Opts<Row<'gold_items'>>) =>
  useQuery({ ...tableQuery('gold_items', [{ column: 'purchase_date', ascending: false }]), ...o })
export const useGoldPrices = (o?: Opts<Row<'gold_prices'>>) =>
  useQuery({ ...tableQuery('gold_prices', [{ column: 'price_at', ascending: false }], 400), ...o })
export const useContacts = (o?: Opts<Row<'contacts'>>) => useQuery({ ...tableQuery('contacts', [{ column: 'name' }]), ...o })
export const useDebts = (o?: Opts<Row<'debts'>>) => useQuery({ ...tableQuery('debts', [{ column: 'date', ascending: false }]), ...o })
export const useDebtPayments = (o?: Opts<Row<'debt_payments'>>) =>
  useQuery({ ...tableQuery('debt_payments', [{ column: 'date', ascending: false }]), ...o })
export const useRecurring = (o?: Opts<Row<'recurring_transactions'>>) =>
  useQuery({ ...tableQuery('recurring_transactions', [{ column: 'next_date' }]), ...o })
export const useBudgets = (o?: Opts<Row<'budgets'>>) => useQuery({ ...tableQuery('budgets'), ...o })

/** The most recent ~4 years of daily snapshots, returned oldest first. */
export const useSnapshots = (o?: Opts<Row<'net_worth_snapshots'>>) =>
  useQuery({
    queryKey: ['net_worth_snapshots'] as const,
    queryFn: async () => (await fetchTable('net_worth_snapshots', [{ column: 'snapshot_date', ascending: false }], 1500)).reverse(),
    ...o,
  })

export function useSettings() {
  return useQuery({
    queryKey: ['settings'] as const,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** All transactions in an inclusive date range (default: all), newest first. */
export function useTransactions(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['transactions', range?.from ?? null, range?.to ?? null] as const,
    queryFn: () =>
      fetchPaged<Transaction>(() => {
        let q = supabase.from('transactions').select('*')
        if (range?.from) q = q.gte('date', range.from)
        if (range?.to) q = q.lte('date', range.to)
        return q.order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true })
      }),
  })
}

/**
 * Who you've received from / paid (the "From" / "Paid to" field) with the category used, newest
 * first: feeds the suggestions in the transaction form. Only the few columns needed.
 */
export function usePayeeHistory() {
  return useQuery({
    queryKey: ['transactions', 'payees'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('type,payee,category_id,date')
        .neq('type', 'transfer')
        .not('payee', 'is', null)
        .order('date', { ascending: false })
        .limit(1500)
      if (error) throw error
      return (data ?? []) as Pick<Transaction, 'type' | 'payee' | 'category_id' | 'date'>[]
    },
    staleTime: 5 * 60_000,
  })
}

/** Everything that touched the given credit card balances on or after the "from" date (spending, payments, refunds). */
export function useCardActivity(subIds: string[], from: string) {
  const ids = [...subIds].sort()
  return useQuery({
    queryKey: ['transactions', 'cards', from, ids.join(',')] as const,
    enabled: ids.length > 0,
    queryFn: () =>
      fetchPaged<Transaction>(() =>
        supabase
          .from('transactions')
          .select('*')
          .or(`sub_account_id.in.(${ids.join(',')}),to_sub_account_id.in.(${ids.join(',')})`)
          .gte('date', from)
          .order('date', { ascending: false })
          .order('id', { ascending: true }),
      ),
  })
}

/** Interest postings of Clouds only (small, and independent of the date range being viewed). */
export function useYieldTransactions() {
  return useQuery({
    queryKey: ['transactions', 'yield'] as const,
    queryFn: () =>
      fetchPaged<Transaction>(() => supabase.from('transactions').select('*').eq('source', 'yield').order('date', { ascending: false }).order('id', { ascending: true })),
  })
}

export const ALL_TABLES: TableName[] = [
  'currencies', 'settings', 'exchange_rates', 'accounts', 'sub_accounts', 'categories', 'tags', 'transactions',
  'recurring_transactions', 'budgets', 'certificates', 'certificate_payouts', 'investment_categories', 'holdings', 'holding_sales', 'card_installment_plans',
  'gold_items', 'gold_prices', 'contacts', 'debts', 'debt_payments', 'net_worth_snapshots', 'yield_rates',
]
