import { useMemo } from 'react'
import { useBudgets, useCategories, useDebtPayments, useDebts, useRecurring, useSnapshots, useSubAccounts, useTransactions } from '@/api/queries'
import { useConvert, useHistoricalConvert, useMoneyFormatter } from '@/hooks/useMoney'
import { convert } from '@/domain/currency'
import { d, type NumericInput } from '@/domain/money'
import { todayIso } from '@/domain/format'
import {
  categoryBreakdown, categoryChanges, fixedVsVariable, generateInsights, largestTransactions, monthlySeries, periodTotals, previousRange,
  spendingProjection, topPayees, weekPattern, type DateRange,
} from '@/domain/insights'
import { partyTotals } from '@/domain/categoryStats'
import { debtActivity } from '@/domain/debts'
import { addDaysIso, byId, daysBetween, endOfMonthIso, startOfMonthIso } from '@/utils'

const minIso = (a: string, b: string) => (a < b ? a : b)

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
  const { data: debts } = useDebts()
  const { data: debtPayments } = useDebtPayments()
  const { between } = useConvert()
  const { toDisplayAt, tableAt, display } = useHistoricalConvert()
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
    // every amount is converted at the rate of its own date
    const toBase = (amount: NumericInput, currency: string, date: string) => toDisplayAt(amount, currency, date)
    const money = (v: NumericInput) => fmt(v, display, { compact: true })
    const fixedCategoryIds = new Set((recurring ?? []).filter((r) => r.type === 'expense' && r.category_id).map((r) => r.category_id!))
    const isCurrentMonth = period === 'this'
    // a period still in progress (this month, or the last 3/6/12 months ending this month)
    const partial = today < range.to
    const elapsedTo = partial ? today : range.to

    // per-day figures count only the days that have happened
    const totals = periodTotals(filtered, range, toBase, today)
    // a period in progress is compared with the same number of days of the previous one
    const prevCompareTo = partial ? minIso(prev.to, addDaysIso(prev.from, daysBetween(range.from, elapsedTo))) : prev.to
    const prevCmp = { from: prev.from, to: prevCompareTo }
    const prevCompareLabel = !partial ? 'vs previous' : isCurrentMonth ? 'vs same days last month' : 'vs same point of the previous period'
    const prevTotals = periodTotals(filtered, prevCmp, toBase)
    const expenseCats = categoryBreakdown(filtered, range, 'expense', catMap, toBase)
    const prevExpenseCats = categoryBreakdown(filtered, prevCmp, 'expense', catMap, toBase)
    const incomeCats = categoryBreakdown(filtered, range, 'income', catMap, toBase)
    const changes = categoryChanges(expenseCats.rows, prevExpenseCats.rows)
    const incomeChanges = categoryChanges(incomeCats.rows, categoryBreakdown(filtered, prevCmp, 'income', catMap, toBase).rows)
    // who pays you (the income "From" field)
    // interest from certificates and Clouds is shown on its own line, not as an unnamed source
    const incomeSources = partyTotals(filtered.filter((t) => t.source !== 'certificate' && t.source !== 'yield'), range, 'income', toBase, { limit: 8 })
    const payees = topPayees(filtered, range, toBase, 6)
    const largest = largestTransactions(filtered, range, toBase, 5)
    const fixed = fixedVsVariable(filtered, range, toBase, fixedCategoryIds, catMap)
    const months = monthlySeries(filtered, range, toBase)
    const projection = isCurrentMonth ? spendingProjection(filtered, range, today, toBase) : null
    // only days that have happened count towards per-day averages
    const week = weekPattern(filtered, { from: range.from, to: elapsedTo }, toBase)

    // Net worth change over the period, split into savings vs valuation. Snapshots are taken at
    // the end of a day, so the starting point is the last snapshot *before* the period, and
    // savings are counted only for the days after the start snapshot up to the end snapshot.
    let netWorthChange: { total: ReturnType<typeof d>; fromSavings: ReturnType<typeof d>; fromDebts: ReturnType<typeof d>; start: string; end: string } | null = null
    const snaps = (snapshots ?? []).filter((s) => s.snapshot_date <= range.to)
    const startSnap = [...snaps].reverse().find((s) => s.snapshot_date < range.from) ?? snaps.find((s) => s.snapshot_date >= range.from)
    const endSnap = snaps[snaps.length - 1]
    if (startSnap && endSnap && startSnap.snapshot_date < endSnap.snapshot_date && !filters.accountId && !filters.tag) {
      const a = convert(startSnap.total, startSnap.base_currency, display, tableAt(startSnap.snapshot_date)) ?? d(startSnap.total)
      const b = convert(endSnap.total, endSnap.base_currency, display, tableAt(endSnap.snapshot_date)) ?? d(endSnap.total)
      const span = { from: addDaysIso(startSnap.snapshot_date, 1), to: endSnap.snapshot_date }
      const saved = periodTotals(filtered, span, toBase).net
      // repayments (money moving for a debt) change net worth too, and aren't a change in asset values
      const fromDebts = debtActivity(debts ?? [], debtPayments ?? [], span, toBase).balanceEffect
      netWorthChange = { total: b.minus(a), fromSavings: saved, fromDebts, start: startSnap.snapshot_date, end: endSnap.snapshot_date }
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

    const insights = generateInsights({ txs: filtered, range, today, toBase, categories: catMap, fixedCategoryIds, money, isCurrentMonth, prevRange: prevCmp, netWorthChange, budgetsOver })
    const allTags = Array.from(new Set((txs ?? []).flatMap((t) => t.tags))).sort()
    // money lent, borrowed and repaid: not income or spending, shown on its own (only without filters:
    // debts have no tags, and one debt's money can move through several accounts)
    const debtsInPeriod = filters.accountId || filters.tag ? null : debtActivity(debts ?? [], debtPayments ?? [], range, toBase)
    const interestEarned = filtered.filter((t) => t.type === 'income' && (t.source === 'certificate' || t.source === 'yield') && t.date >= range.from && t.date <= range.to).reduce((a, t) => a.plus(toBase(t.amount, t.currency, t.date)), d(0))

    return { range, prev, prevCompareTo, prevCompareLabel, totals, prevTotals, expenseCats, incomeCats, changes, incomeChanges, incomeSources, payees, largest, fixed, months, projection, week, insights, netWorthChange, allTags, display, catMap, isLoading, interestEarned, isCurrentMonth, partial, debts: debtsInPeriod }
  }, [txs, categories, subs, recurring, budgets, snapshots, debts, debtPayments, filters, range, prev, toDisplayAt, tableAt, display, between, fmt, today, period, isLoading])
}
