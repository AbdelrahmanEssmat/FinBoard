import { useMemo } from 'react'
import { useBudgets, useCategories, useTransactions } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { isExpense } from '@/domain/insights'
import { d } from '@/domain/money'
import { byId, endOfMonthIso, startOfMonthIso } from '@/utils'

/** This month's budgets: how much of each is spent (sub-categories count towards their parent), most used first. */
export function useBudgetUsage() {
  const { data: budgets, isLoading } = useBudgets()
  const { data: categories } = useCategories()
  const { data: txs } = useTransactions({ from: startOfMonthIso(), to: endOfMonthIso() })
  const { betweenAt } = useHistoricalConvert()
  const catMap = useMemo(() => byId(categories), [categories])
  const rows = useMemo(
    () =>
      (budgets ?? [])
        .map((b) => {
          const cat = catMap.get(b.category_id)
          const childIds = new Set((categories ?? []).filter((c) => c.parent_id === b.category_id).map((c) => c.id))
          let spent = d(0)
          for (const t of txs ?? []) {
            if (!isExpense(t) || !t.category_id) continue
            // each expense converted into the budget's currency at the rate of its own day
            if (t.category_id === b.category_id || childIds.has(t.category_id)) spent = spent.plus(betweenAt(t.amount, t.currency, b.currency, t.date) ?? d(0))
          }
          const pct = d(b.amount).isZero() ? 0 : spent.div(d(b.amount)).times(100).toNumber()
          return { b, cat, spent, pct, left: d(b.amount).minus(spent) }
        })
        .sort((a, b) => b.pct - a.pct),
    [budgets, catMap, categories, txs, betweenAt],
  )
  return { rows, budgets, categories, catMap, isLoading }
}
