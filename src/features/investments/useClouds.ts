import { useMemo } from 'react'
import { useAccounts, useSubAccounts, useYieldTransactions } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d, Decimal } from '@/domain/money'
import { daysUntilNextYield, nextYieldDate, projectedMonthlyYield, type YieldFrequency } from '@/domain/yield'
import { todayIso } from '@/domain/format'
import { byId, startOfMonthIso } from '@/utils'
import type { Account, SubAccount } from '@/api/database.types'

export interface CloudView extends SubAccount {
  account: Account | undefined
  frequency: YieldFrequency
  /** interest already credited (all time) and this month, in the cloud's currency */
  earnedTotal: Decimal
  earnedThisMonth: Decimal
  projectedMonthly: Decimal
  nextPayout: string
  daysToPayout: number
  valueDisplay: Decimal
}

/** Yield-bearing balances (Clouds) with their earnings. */
export function useClouds() {
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const { data: yieldTxs } = useYieldTransactions()
  const { toDisplayOrZero, display } = useConvert()
  const today = todayIso()

  const list = useMemo<CloudView[]>(() => {
    const accMap = byId(accounts)
    const monthStart = startOfMonthIso()
    return (subs ?? [])
      .filter((s) => s.yield_rate !== null && s.yield_frequency && !s.is_archived)
      .map((s) => {
        const freq = (s.yield_frequency === 'daily' ? 'daily' : 'monthly') as YieldFrequency
        const mine = (yieldTxs ?? []).filter((t) => t.source === 'yield' && t.sub_account_id === s.id)
        const earnedTotal = mine.reduce((a, t) => a.plus(d(t.amount)), d(0))
        const earnedThisMonth = mine.filter((t) => t.date >= monthStart).reduce((a, t) => a.plus(d(t.amount)), d(0))
        return {
          ...s,
          account: accMap.get(s.account_id),
          frequency: freq,
          earnedTotal,
          earnedThisMonth,
          projectedMonthly: projectedMonthlyYield(s.balance, s.yield_rate ?? 0, freq),
          nextPayout: nextYieldDate(s.yield_since, freq, today),
          daysToPayout: daysUntilNextYield(s.yield_since, freq, today),
          valueDisplay: toDisplayOrZero(s.balance, s.currency),
        }
      })
  }, [subs, accounts, yieldTxs, toDisplayOrZero, today])

  const total = list.reduce((a, c) => a.plus(c.valueDisplay), d(0))
  const projectedMonthlyDisplay = list.reduce((a, c) => a.plus(toDisplayOrZero(c.projectedMonthly, c.currency)), d(0))
  return { list, total, projectedMonthlyDisplay, display }
}
