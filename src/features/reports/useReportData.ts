import { useMemo } from 'react'
import { useBudgets, useCategories, useRecurring, useSnapshots, useSubAccounts, useTransactions } from '@/api/queries'
import { useConvert, useMoneyFormatter } from '@/hooks/useMoney'
import { convert } from '@/domain/currency'
import { d, type NumericInput } from '@/domain/money'
import { todayIso } from '@/domain/format'
import {
  categoryBreakdown, categoryChanges, fixedVsVariable, generateInsights, largestTransactions, monthlySeries, periodTotals, previousRange,
  spendingProjection, topPayees, weekPattern, type DateRange,
} from '@/domain/insights'
import { byId, endOfMonthIso, startOfMonthIso } from '@/utils'

export type ReportPeriod = 'this' | 'last' | '3' | '6' | '12'

export const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'this', label: 'Month' },
  { value: 'last', label: 'Last' },
  { value: '3', label: '3 mo' },
  { value: '6', label: '6 mo' },
  { value: '12', label: '12 mo' },
]

export function periodRange(p: ReportPeriod, now = new Date()): DateRange {
  if (p === 'this') return { from: startOfMonthIso(now), to: endOfMonthIso(now) }
  if (p === 'last') {
    const m = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { from: startOfMonthIso(m), to: endOfMonthIso(m) }
  }
  const months = Number(p)
  return { from: startOfMonthIso(new Date(now.getFullYear(), now.getMonth() - months + 1, 1)), to: endOfMonthIso(now) }
}

export interface ReportFilters {
  accountId: string
  tag: string
}

export function useReportData(period: ReportPeriod, filters: ReportFilters) {
  const range = useMemo(() => periodRange(period), [period])
  const prev = useMemo(() => previousRange(range), [range])
  const { data: txs, isLoading } = useTransactions({ from: prev.from, to: range.to })
  const { data: categories } = useCategories()
  const { data: subs } = useSubAccounts()
  const { data: recurring } = useRecurring()
  const { data: budgets } = useBudgets()
  const { data: snapshots } = useSnapshots()
  const { toDisplayOrZero, display, rates, between } = useConvert()
  const fmt = useMoneyFormatter()
  const today = todayIso()

  return useMemo(() => {
    const catMap = new Map((categories ?? []).map((c) => [c.id, c]))
    const subMap = byId(subs)
    const filtered = (txs ?? []).filter((t) => {
      if (filters.accountId && subMap.get(t.sub_account_id)?.account_id !== filters.accountId) return false
      if (filters.tag && !t.tags.includes(filters.tag)) return false
      return true
    })
    const toBase = (amount: NumericInput, currency: string) => toDisplayOrZero(amount, currency)
    const money = (v: NumericInput) => fmt(v, display, { compact: true })
    const fixedCategoryIds = new Set((recurring ?? []).filter((r) => r.type === 'expense' && r.category_id).map((r) => r.category_id!))

    const totals = periodTotals(filtered, range, toBase)
    const prevTotals = periodTotals(filtered, prev, toBase)
    const expenseCats = categoryBreakdown(filtered, range, 'expense', catMap, toBase)
    const prevExpenseCats = categoryBreakdown(filtered, prev, 'expense', catMap, toBase)
    const incomeCats = categoryBreakdown(filtered, range, 'income', catMap, toBase)
    const changes = categoryChanges(expenseCats.rows, prevExpenseCats.rows)
    const payees = topPayees(filtered, range, toBase, 6)
    const largest = largestTransactions(filtered, range, toBase, 5)
    const fixed = fixedVsVariable(filtered, range, toBase, fixedCategoryIds, catMap)
    const months = monthlySeries(filtered, range, toBase)
    const isCurrentMonth = period === 'this'
    const projection = isCurrentMonth ? spendingProjection(filtered, range, today, toBase) : null
    const week = weekPattern(filtered, range, toBase)

    // net worth change over the period (from daily snapshots), split into savings vs valuation
    let netWorthChange: { total: ReturnType<typeof d>; fromSavings: ReturnType<typeof d>; start: string; end: string } | null = null
    const snaps = (snapshots ?? []).filter((s) => s.snapshot_date <= range.to)
    const startSnap = [...snaps].reverse().find((s) => s.snapshot_date <= range.from) ?? snaps.find((s) => s.snapshot_date >= range.from)
    const endSnap = snaps[snaps.length - 1]
    if (startSnap && endSnap && startSnap.snapshot_date < endSnap.snapshot_date && !filters.accountId && !filters.tag) {
      const a = convert(startSnap.total, startSnap.base_currency, display, rates) ?? d(startSnap.total)
      const b = convert(endSnap.total, endSnap.base_currency, display, rates) ?? d(endSnap.total)
      netWorthChange = { total: b.minus(a), fromSavings: totals.net, start: startSnap.snapshot_date, end: endSnap.snapshot_date }
    }

    // budgets over limit (this month only)
    const budgetsOver: string[] = []
    if (isCurrentMonth) {
      for (const b of budgets ?? []) {
        const cat = catMap.get(b.category_id)
        const spent = expenseCats.rows.find((r) => r.id === b.category_id)?.value ?? d(0)
        const limit = between(b.amount, b.currency, display) ?? d(0)
        if (cat && limit.gt(0) && spent.gt(limit)) budgetsOver.push(cat.name)
      }
    }

    const insights = generateInsights({ txs: filtered, range, today, toBase, categories: catMap, fixedCategoryIds, money, isCurrentMonth, netWorthChange, budgetsOver })
    const allTags = Array.from(new Set((txs ?? []).flatMap((t) => t.tags))).sort()
    const interestEarned = filtered.filter((t) => t.type === 'income' && (t.source === 'certificate' || t.source === 'yield') && t.date >= range.from && t.date <= range.to).reduce((a, t) => a.plus(toBase(t.amount, t.currency)), d(0))

    return { range, prev, totals, prevTotals, expenseCats, incomeCats, changes, payees, largest, fixed, months, projection, week, insights, netWorthChange, allTags, display, catMap, isLoading, interestEarned, isCurrentMonth }
  }, [txs, categories, subs, recurring, budgets, snapshots, filters, range, prev, toDisplayOrZero, display, rates, between, fmt, today, period, isLoading])
}
