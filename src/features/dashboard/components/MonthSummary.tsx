import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, HandCoins, PiggyBank } from 'lucide-react'
import { Amount, Section, StatCard } from '@/components/shared'
import { useDebtPayments, useDebts, useTransactions } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { isExpense, isIncome } from '@/domain/insights'
import { debtActivity } from '@/domain/debts'
import { d } from '@/domain/money'
import { endOfMonthIso, startOfMonthIso } from '@/utils'

export function MonthSummary() {
  const navigate = useNavigate()
  const { data: txs } = useTransactions({ from: startOfMonthIso(), to: endOfMonthIso() })
  const { data: debts } = useDebts()
  const { data: payments } = useDebtPayments()
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
  // ... so money lent, borrowed or repaid this month is shown on its own line: it moved balances
  const debtLine = useMemo(() => {
    const a = debtActivity(debts ?? [], payments ?? [], { from: startOfMonthIso(), to: endOfMonthIso() }, toDisplayAt)
    return [
      { label: 'lent', value: a.lent },
      { label: 'got back', value: a.receivedBack },
      { label: 'borrowed', value: a.borrowed },
      { label: 'paid back', value: a.paidBack },
    ].filter((p) => p.value.gt(0))
  }, [debts, payments, toDisplayAt])

  return (
    <Section
      title="This month"
      action={
        <button onClick={() => navigate('/reports')} className="-my-1.5 -mr-2 flex min-h-11 items-center px-2 text-xs font-medium text-accent">
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
      {debtLine.length ? (
        <button
          onClick={() => navigate('/debts')}
          className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-left text-xs text-muted active:opacity-80"
        >
          <HandCoins className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 leading-5">
            <span className="font-medium text-text">Debts</span>, not counted above:{' '}
            {debtLine.map((p, i) => (
              <span key={p.label}>
                {i > 0 ? ' · ' : ''}
                <span className="whitespace-nowrap">
                  {p.label} <Amount value={p.value} currency={display} decimals={0} compact size="sm" className="text-xs font-medium text-text" />
                </span>
              </span>
            ))}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
        </button>
      ) : null}
    </Section>
  )
}
