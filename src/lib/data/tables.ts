import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { supabase } from '../supabase'
import type { Row, TableName, Transaction } from '../database.types'

type OrderSpec = { column: string; ascending?: boolean }

async function fetchTable<T extends TableName>(table: T, order?: OrderSpec[], limit?: number): Promise<Row<T>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from(table).select('*')
  for (const o of order ?? []) q = q.order(o.column, { ascending: o.ascending ?? true })
  if (limit) q = q.limit(limit)
  const { data, error } = await q
  if (error) throw error
  return data as Row<T>[]
}

function tableQuery<T extends TableName>(table: T, order?: OrderSpec[], limit?: number) {
  return { queryKey: [table] as const, queryFn: () => fetchTable(table, order, limit) }
}

type Opts<T> = Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>

export const useAccounts = (o?: Opts<Row<'accounts'>>) =>
  useQuery({ ...tableQuery('accounts', [{ column: 'sort_order' }, { column: 'created_at' }]), ...o })
export const useSubAccounts = (o?: Opts<Row<'sub_accounts'>>) =>
  useQuery({ ...tableQuery('sub_accounts', [{ column: 'sort_order' }, { column: 'created_at' }]), ...o })
export const useCategories = (o?: Opts<Row<'categories'>>) =>
  useQuery({ ...tableQuery('categories', [{ column: 'sort_order' }, { column: 'name' }]), ...o })
export const useTags = (o?: Opts<Row<'tags'>>) => useQuery({ ...tableQuery('tags', [{ column: 'name' }]), ...o })
export const useCurrencies = (o?: Opts<Row<'currencies'>>) =>
  useQuery({ ...tableQuery('currencies', [{ column: 'sort_order' }, { column: 'code' }]), ...o })
export const useRates = (o?: Opts<Row<'exchange_rates'>>) =>
  useQuery({ ...tableQuery('exchange_rates', [{ column: 'rate_date', ascending: false }], 2000), ...o })
export const useCertificates = (o?: Opts<Row<'certificates'>>) =>
  useQuery({ ...tableQuery('certificates', [{ column: 'maturity_date' }]), ...o })
export const usePayouts = (o?: Opts<Row<'certificate_payouts'>>) =>
  useQuery({ ...tableQuery('certificate_payouts', [{ column: 'due_date' }]), ...o })
export const useInvestmentCategories = (o?: Opts<Row<'investment_categories'>>) =>
  useQuery({ ...tableQuery('investment_categories', [{ column: 'sort_order' }]), ...o })
export const useHoldings = (o?: Opts<Row<'holdings'>>) => useQuery({ ...tableQuery('holdings', [{ column: 'name' }]), ...o })
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
export const useSnapshots = (o?: Opts<Row<'net_worth_snapshots'>>) =>
  useQuery({ ...tableQuery('net_worth_snapshots', [{ column: 'snapshot_date' }], 2000), ...o })

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

/** Transactions in an inclusive date range (default: all). Ordered newest first. */
export function useTransactions(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['transactions', range?.from ?? null, range?.to ?? null] as const,
    queryFn: async () => {
      let q = supabase.from('transactions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })
      if (range?.from) q = q.gte('date', range.from)
      if (range?.to) q = q.lte('date', range.to)
      const { data, error } = await q.limit(5000)
      if (error) throw error
      return data as Transaction[]
    },
  })
}

export const ALL_TABLES: TableName[] = [
  'currencies', 'settings', 'exchange_rates', 'accounts', 'sub_accounts', 'categories', 'tags', 'transactions',
  'recurring_transactions', 'budgets', 'certificates', 'certificate_payouts', 'investment_categories', 'holdings',
  'gold_items', 'gold_prices', 'contacts', 'debts', 'debt_payments', 'net_worth_snapshots',
]
