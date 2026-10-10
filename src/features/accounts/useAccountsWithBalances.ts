import { useMemo } from 'react'
import { useAccounts, useHoldings, useSubAccounts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d, Decimal } from '@/domain/money'
import { holdingsValueByAccount } from '@/domain/investments'
import type { Account, SubAccount } from '@/api/database.types'

export interface AccountWithBalances extends Account {
  subs: SubAccount[]
  /** stocks and funds held on this account (an investment platform), at the latest prices */
  invested: Decimal
  /** all its balances plus its stocks and funds, in the display currency */
  total: Decimal
}

export function useAccountsWithBalances(opts: { includeArchived?: boolean } = {}) {
  const accounts = useAccounts()
  const subs = useSubAccounts()
  const holdings = useHoldings()
  const { toDisplayOrZero, display } = useConvert()
  const list = useMemo<AccountWithBalances[]>(() => {
    const all = (accounts.data ?? []).filter((a) => opts.includeArchived || !a.is_archived)
    const investedBy = holdingsValueByAccount(holdings.data ?? [], toDisplayOrZero)
    return all.map((a) => {
      const mine = (subs.data ?? []).filter((s) => s.account_id === a.id && (opts.includeArchived || !s.is_archived))
      const invested = investedBy.get(a.id) ?? d(0)
      const total = mine.reduce((acc, s) => acc.plus(toDisplayOrZero(s.balance, s.currency)), invested)
      return { ...a, subs: mine, invested, total }
    })
  }, [accounts.data, subs.data, holdings.data, toDisplayOrZero, opts.includeArchived])
  const grandTotal = useMemo(() => list.reduce((acc, a) => acc.plus(a.total), d(0)), [list])
  return { list, grandTotal, display, isLoading: accounts.isLoading || subs.isLoading, isEmpty: !accounts.isLoading && (accounts.data?.length ?? 0) === 0 }
}

/** Label like "CIB · USD · Savings" for a sub-account. */
export function subAccountLabel(sub: SubAccount | undefined, accounts: Map<string, Account>): string {
  if (!sub) return '—'
  const acc = accounts.get(sub.account_id)
  return [acc?.name ?? 'Account', sub.currency, sub.name].filter(Boolean).join(' · ')
}

export const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  bank: 'Bank',
  cash: 'Cash',
  investment: 'Investment platform',
  wallet: 'Wallet / prepaid card',
  credit_card: 'Credit card',
  other: 'Other',
}
