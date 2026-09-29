import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, PiggyBank } from 'lucide-react'
import { Amount, Section, StatCard } from '@/components/shared'
import { useTransactions } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { isExpense, isIncome } from '@/domain/insights'
import { d } from '@/domain/money'
import { endOfMonthIso, startOfMonthIso } from '@/utils'

export function MonthSummary() {
  const navigate = useNavigate()
  const { data: txs } = useTransactions({ from: startOfMonthIso(), to: endOfMonthIso() })
  const { toDisplayAt, display } = useHistoricalConvert()
  const month = useMemo(() => {
    let income = d(0)
    let expense = d(0)
    for (const t of txs ?? []) {
      // real income/spending only (not borrowing, lending or repayments), at each day's rate
      if (isIncome(t)) income = income.plus(toDisplayAt(t.amount, t.currency, t.date))
      else if (isExpense(t)) expense = expense.plus(toDisplayAt(t.amount, t.currency, t.date))
    }
    return { income, expense, savings: income.minus(expense) }
  }, [txs, toDisplayAt])

  return (
    <Section
      title="This month"
      action={
        <button onClick={() => navigate('/reports')} className="text-xs font-medium text-accent">
          Reports
        </button>
      }
    >
      {/* three tiles across a phone: whole amounts, shrunk to fit when long */}
      <div className="grid grid-cols-3 gap-2 min-[360px]:gap-3">
        <StatCard label="Income" icon={ArrowDownLeft} iconClass="text-positive" value={<Amount value={month.income} currency={display} decimals={0} compact fit />} />
        <StatCard label="Spending" icon={ArrowUpRight} iconClass="text-negative" value={<Amount value={month.expense} currency={display} decimals={0} compact fit />} />
        <StatCard label="Saved" icon={PiggyBank} iconClass="text-accent" value={<Amount value={month.savings} currency={display} colored decimals={0} compact fit />} />
      </div>
    </Section>
  )
}
