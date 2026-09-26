import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, PiggyBank } from 'lucide-react'
import { Amount, Section, StatCard } from '@/components/shared'
import { useTransactions } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d } from '@/domain/money'
import { endOfMonthIso, startOfMonthIso } from '@/utils'

export function MonthSummary() {
  const navigate = useNavigate()
  const { data: txs } = useTransactions({ from: startOfMonthIso(), to: endOfMonthIso() })
  const { toDisplayOrZero, display } = useConvert()
  const month = useMemo(() => {
    let income = d(0)
    let expense = d(0)
    for (const t of txs ?? []) {
      if (t.type === 'income') income = income.plus(toDisplayOrZero(t.amount, t.currency))
      else if (t.type === 'expense') expense = expense.plus(toDisplayOrZero(t.amount, t.currency))
    }
    return { income, expense, savings: income.minus(expense) }
  }, [txs, toDisplayOrZero])

  return (
    <Section
      title="This month"
      action={
        <button onClick={() => navigate('/reports')} className="text-xs font-medium text-accent">
          Reports
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Income" icon={ArrowDownLeft} iconClass="text-positive" value={<Amount value={month.income} currency={display} compact />} />
        <StatCard label="Spending" icon={ArrowUpRight} iconClass="text-negative" value={<Amount value={month.expense} currency={display} compact />} />
        <StatCard label="Saved" icon={PiggyBank} iconClass="text-accent" value={<Amount value={month.savings} currency={display} colored compact />} />
      </div>
    </Section>
  )
}
