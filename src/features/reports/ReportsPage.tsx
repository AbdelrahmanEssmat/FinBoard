import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, PiggyBank } from 'lucide-react'
import { Segmented, Select, Skeleton } from '@/components/ui'
import { Amount, PageHeader, StatCard } from '@/components/shared'
import { useAccounts } from '@/api/queries'
import { formatDate } from '@/domain/format'
import type { Decimal } from '@/domain/money'
import { PERIOD_OPTIONS, useReportData, type ReportFilters, type ReportPeriod } from '@/features/reports/useReportData'
import { InsightsCard } from '@/features/reports/components/InsightsCard'
import { IncomeVsSpendingChart } from '@/features/reports/components/IncomeVsSpendingChart'
import { CategoryBreakdownCard } from '@/features/reports/components/CategoryBreakdownCard'
import { SpendingStructureCard } from '@/features/reports/components/SpendingStructureCard'
import { LargestTransactionsCard, TopPayeesCard } from '@/features/reports/components/TopListsCard'

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('this')
  const [filters, setFilters] = useState<ReportFilters>({ accountId: '', tag: '' })
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const { data: accounts } = useAccounts()
  const r = useReportData(period, filters)

  const savedTone = r.totals.net.gt(0) ? 'text-positive' : r.totals.net.lt(0) ? 'text-negative' : ''
  const rangeLabel = `${formatDate(r.range.from, 'd MMM')} – ${formatDate(r.range.to, 'd MMM yyyy')}`

  return (
    <div className="anim-fade-up">
      <PageHeader back title="Reports" subtitle={rangeLabel} />

      <div className="mb-8 space-y-4">
        <Segmented value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        <div className="grid grid-cols-2 gap-4">
          <Select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })} aria-label="Account">
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} aria-label="Tag">
            <option value="">All tags</option>
            {r.allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {r.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Income"
              icon={ArrowDownLeft}
              iconClass="text-positive"
              value={<Amount value={r.totals.income} currency={r.display} compact />}
              foot={r.prevTotals.income.gt(0) ? <PrevDelta cur={r.totals.income} prev={r.prevTotals.income} good="up" /> : undefined}
            />
            <StatCard
              label="Spending"
              icon={ArrowUpRight}
              iconClass="text-negative"
              value={<Amount value={r.totals.expense} currency={r.display} compact />}
              foot={r.prevTotals.expense.gt(0) ? <PrevDelta cur={r.totals.expense} prev={r.prevTotals.expense} good="down" /> : undefined}
            />
            <StatCard
              label="Saved"
              icon={PiggyBank}
              iconClass="text-accent"
              value={<Amount value={r.totals.net} currency={r.display} compact className={savedTone} />}
              foot={r.totals.savingsRate ? `${r.totals.savingsRate.toFixed(0)}% of income` : 'no income recorded'}
            />
            <StatCard
              label="Per day"
              icon={CalendarDays}
              value={<Amount value={r.projection ? r.projection.avgDaily : r.totals.avgDailySpend} currency={r.display} compact />}
              foot={`${r.totals.expenseCount} expense${r.totals.expenseCount === 1 ? '' : 's'}`}
            />
          </div>

          <InsightsCard insights={r.insights} />
          <IncomeVsSpendingChart months={r.months} display={r.display} />
          <SpendingStructureCard fixed={r.fixed} projection={r.projection} week={r.week} display={r.display} rangeTo={r.range.to} />
          <CategoryBreakdownCard kind={kind} onKind={setKind} expense={r.changes} income={r.incomeCats.rows} display={r.display} />
          <TopPayeesCard payees={r.payees} display={r.display} />
          <LargestTransactionsCard items={r.largest} display={r.display} categories={r.catMap} />
        </div>
      )}
    </div>
  )
}

function PrevDelta({ cur, prev, good }: { cur: Decimal; prev: Decimal; good: 'up' | 'down' }) {
  const pct = cur.minus(prev).div(prev).times(100)
  const isGood = good === 'up' ? pct.gte(0) : pct.lte(0)
  return (
    <span className={isGood ? 'text-positive' : 'text-negative'}>
      {pct.gte(0) ? '+' : ''}
      {pct.toFixed(0)}% vs previous
    </span>
  )
}
