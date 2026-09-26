import { useMemo } from 'react'
import { useAccounts, useCertificates, useDebtPayments, useDebts, useGoldItems, useHoldings, useSubAccounts } from '@/lib/data/tables'
import { useConvert, useGoldPriceTable } from '@/lib/data/derived'
import { computeNetWorth } from '@/domain/networth'
import { byId } from '@/lib/utils'

export function useNetWorth() {
  const accounts = useAccounts()
  const subs = useSubAccounts()
  const certs = useCertificates()
  const holdings = useHoldings()
  const gold = useGoldItems()
  const goldPrices = useGoldPriceTable()
  const debts = useDebts()
  const payments = useDebtPayments()
  const { display, rates } = useConvert()

  const result = useMemo(() => {
    const accMap = byId(accounts.data)
    const paymentsByDebt: Record<string, { amount: number; date: string }[]> = {}
    for (const p of payments.data ?? []) (paymentsByDebt[p.debt_id] ??= []).push(p)
    return computeNetWorth({
      base: display,
      rates,
      subAccounts: (subs.data ?? []).map((s) => ({ ...s, account: accMap.get(s.account_id) ?? null })),
      certificates: certs.data ?? [],
      holdings: holdings.data ?? [],
      gold: gold.data ?? [],
      goldPrices,
      debts: debts.data ?? [],
      paymentsByDebt,
    })
  }, [accounts.data, subs.data, certs.data, holdings.data, gold.data, goldPrices, debts.data, payments.data, display, rates])

  const isLoading = [accounts, subs, certs, holdings, gold, debts, payments].some((q) => q.isLoading && !q.data)
  return { ...result, display, isLoading }
}
