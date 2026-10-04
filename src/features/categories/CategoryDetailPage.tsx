import { createElement, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { CalendarRange, Hash, Pencil, Plus, Trophy, TrendingDown, TrendingUp } from 'lucide-react'
import { Button, Card, Divider, ProgressBar, Segmented, Skeleton } from '@/components/ui'
import { Amount, NotFound, PageHeader, PageSkeleton, Section, StatCard } from '@/components/shared'
import { useBudgets, useCategories, useTransactions } from '@/api/queries'
import { useConvert, useHistoricalConvert } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { d } from '@/domain/money'
import { formatMoney, formatPercent, todayIso } from '@/domain/format'
import { HIDDEN } from '@/domain/privacy'
import { isExpense, isIncome } from '@/domain/insights'
import { categoryFamily, categoryMonthly, monthKeys, partyTotals, subcategorySplit, summarizeCategory } from '@/domain/categoryStats'
import { iconFor } from '@/utils/icons'
import { cn, endOfMonthIso, startOfMonthIso } from '@/utils'
import { TransactionList } from '@/features/transactions/components/TransactionList'
import { TransactionForm } from '@/features/transactions/components/TransactionForm'
import { CategoryForm } from '@/features/categories/components/CategoryForm'
import type { Transaction } from '@/api/database.types'

type Window = '3' | '6' | '12'
const WINDOWS: { value: Window; label: string }[] = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
]
const LIST_PREVIEW = 20
const monthLabel = (key: string, style: 'short' | 'long' = 'short') => new Date(key + '-01T00:00:00').toLocaleDateString('en-GB', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) })

/** Everything about one income or expense category: totals, trend, split, who, budget, transactions. */
export default function CategoryDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: categories } = useCategories()
  const { data: budgets } = useBudgets()
  const { toDisplayAt, display } = useHistoricalConvert()
  const { between } = useConvert()
  const privacy = usePrefs((s) => s.privacy)
  const [win, setWin] = useState<Window>('6')
  const [showAll, setShowAll] = useState(false)
  const [edit, setEdit] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)

  const today = todayIso()
  // one query covers every window: the last 12 whole months
  const yearFrom = startOfMonthIso(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))
  const { data: txs, isLoading } = useTransactions({ from: yearFrom, to: endOfMonthIso(new Date()) })

  const cat = categories?.find((c) => c.id === id)
  const parent = cat?.parent_id ? categories?.find((c) => c.id === cat.parent_id) : undefined
  const kind = cat?.kind ?? 'expense'
  const color = (parent ?? cat)?.color ?? '#64748b'

  const data = useMemo(() => {
    if (!cat || !categories) return null
    const family = categoryFamily(cat.id, categories)
    const months = monthKeys(today, Number(win))
    const range = { from: months[0] + '-01', to: endOfMonthIso(new Date(months[months.length - 1] + '-01T00:00:00')) }
    const toBase = toDisplayAt
    const series = categoryMonthly(txs ?? [], family, kind, months, toBase)
    const summary = summarizeCategory(series, { today })
    const split = !cat.parent_id ? subcategorySplit(txs ?? [], cat, categories, kind, range, toBase) : []
    const parties = partyTotals(txs ?? [], range, kind, toBase, { only: family, limit: 6 })
    const list = (txs ?? []).filter((t) => t.category_id && family.has(t.category_id) && t.date >= range.from && t.date <= range.to && (kind === 'income' ? isIncome(t) : isExpense(t)))
    return { family, months, range, series, summary, split, parties, list }
  }, [cat, categories, txs, win, kind, today, toDisplayAt])

  if (!cat) return categories ? <NotFound title="Category not found" /> : <PageSkeleton back />

  const word = kind === 'income' ? 'Earned' : 'Spent'
  const budget = kind === 'expense' ? budgets?.find((b) => b.category_id === cat.id) : undefined
  const thisMonth = data?.series[data.series.length - 1]
  const budgetLimit = budget ? between(budget.amount, budget.currency, display) : null
  const up = data?.summary.latestVsAvgPct?.gt(0)
  // more income is good; more spending is not
  const trendGood = data?.summary.latestVsAvgPct ? (kind === 'income' ? up : !up) : null
  const shown = showAll ? data?.list ?? [] : (data?.list ?? []).slice(0, LIST_PREVIEW)

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title={cat.name}
        subtitle={`${kind === 'income' ? 'Income' : 'Spending'} category${parent ? ` · in ${parent.name}` : ''}`}
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Edit category" onClick={() => setEditingCategory(true)}>
              <Pencil className="h-5 w-5" />
            </Button>
            <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        }
      />

      <Segmented className="mb-6" value={win} onChange={setWin} options={WINDOWS} />

      {isLoading && !txs ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : data ? (
        <div className="space-y-8">
          <Card padded>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: color + '22', color }}>
                {createElement(iconFor((parent ?? cat).icon), { className: 'h-5 w-5' })}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">
                  {word} in the last {win} months
                </div>
                <Amount value={data.summary.total} currency={display} size="lg" />
              </div>
            </div>
            <div className="mt-4 text-sm text-muted">
              {data.summary.count ? (
                <>
                  {data.summary.count} transaction{data.summary.count === 1 ? '' : 's'} in {data.summary.activeMonths} month{data.summary.activeMonths === 1 ? '' : 's'}
                </>
              ) : (
                `Nothing recorded here in the last ${win} months.`
              )}
            </div>
          </Card>

          {data.summary.count ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <StatCard label="Per month" icon={CalendarRange} value={<Amount value={data.summary.avgPerMonth} currency={display} compact fit />} foot={data.summary.latestIsPartial ? 'average of full months' : 'average since first entry'} />
              <StatCard
                label="This month"
                icon={up ? TrendingUp : TrendingDown}
                iconClass={trendGood === null ? undefined : trendGood ? 'text-positive' : 'text-negative'}
                value={<Amount value={thisMonth?.value ?? 0} currency={display} compact fit />}
                foot={data.summary.latestVsAvgPct ? <span className={trendGood ? 'text-positive' : 'text-negative'}>{formatPercent(data.summary.latestVsAvgPct, 0)} {data.summary.latestIsPartial ? 'so far vs a usual month' : 'vs usual'}</span> : 'no earlier months'}
              />
              <StatCard label="Best month" icon={Trophy} value={data.summary.best ? <Amount value={data.summary.best.value} currency={display} compact /> : '—'} foot={data.summary.best ? monthLabel(data.summary.best.month, 'long') : undefined} />
              <StatCard label="Per transaction" icon={Hash} value={data.summary.avgPerTransaction ? <Amount value={data.summary.avgPerTransaction} currency={display} compact /> : '—'} foot="average" />
            </div>
          ) : null}

          {data.summary.count ? (
            <Section title="Month by month" action={<span className="text-xs text-muted">Tap a month</span>}>
              <Card padded>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.series.map((m) => ({ month: m.month, label: monthLabel(m.month), value: m.value.toNumber() }))} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                      <XAxis dataKey="label" axisLine={false} tickLine={false} interval={Number(win) > 6 ? 1 : 0} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                      <Tooltip
                        cursor={{ fill: 'var(--color-surface-2)' }}
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg bg-text px-2.5 py-1.5 text-xs text-bg">
                              <div className="font-medium">{monthLabel(String(payload[0]!.payload.month), 'long')}</div>
                              <div>{privacy ? HIDDEN : formatMoney(payload[0]!.value as number, display)}</div>
                            </div>
                          ) : null
                        }
                      />
                      <Bar
                        dataKey="value"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive={false}
                        className="cursor-pointer"
                        // open that month's transactions in Activity, filtered to this category
                        onClick={(bar: { payload?: { month?: string } }) => bar.payload?.month && navigate(`/transactions?category=${cat.id}&month=${bar.payload.month}`)}
                      >
                        {data.series.map((m, i) => (
                          <Cell key={m.month} fill={color} fillOpacity={i === data.series.length - 1 ? 1 : 0.55} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Section>
          ) : null}

          {budget && budgetLimit && budgetLimit.gt(0) ? (
            <Section title="Budget this month">
              <Card padded>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <Amount value={thisMonth?.value ?? 0} currency={display} className="font-semibold" /> <span className="text-muted">of</span> <Amount value={budgetLimit} currency={display} />
                  </span>
                  <span className={cn('text-xs font-medium', (thisMonth?.value ?? d(0)).gt(budgetLimit) ? 'text-negative' : 'text-muted')}>
                    {(thisMonth?.value ?? d(0)).gt(budgetLimit) ? (
                      'over budget'
                    ) : (
                      <>
                        <Amount value={budgetLimit.minus(thisMonth?.value ?? 0)} currency={display} decimals={0} size="sm" /> left
                      </>
                    )}
                  </span>
                </div>
                <ProgressBar className="mt-3" value={(thisMonth?.value ?? d(0)).div(budgetLimit).times(100).toNumber()} color={(thisMonth?.value ?? d(0)).gt(budgetLimit) ? 'var(--color-negative)' : color} />
              </Card>
            </Section>
          ) : null}

          {data.split.length > 1 ? (
            <Section title="By sub-category">
              <Card className="divide-y divide-border">
                {data.split.map((s) => (
                  <div key={s.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[15px] font-medium">{s.name}</span>
                      <Amount value={s.value} currency={display} className="text-sm font-semibold" />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: color }} />
                      </div>
                      <span className="w-16 text-right text-[11px] text-muted">
                        {s.pct.toFixed(0)}% · {s.count}×
                      </span>
                    </div>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}

          {data.parties.rows.length ? (
            <Section title={kind === 'income' ? 'Who paid you' : 'Where it went'}>
              <Card className="overflow-hidden">
                {data.parties.rows.map((p, i) => (
                  <div key={p.name}>
                    {i > 0 ? <Divider /> : null}
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{p.name}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {p.count}× · {p.pct.toFixed(0)}% of this category
                        </div>
                      </div>
                      <Amount value={p.value} currency={display} className="shrink-0 font-semibold" />
                    </div>
                  </div>
                ))}
                {data.parties.unnamed.gt(0) ? (
                  <>
                    <Divider />
                    <div className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm text-muted">
                      <span>Without a {kind === 'income' ? '“From”' : '“Paid to”'} name</span>
                      <Amount value={data.parties.unnamed} currency={display} />
                    </div>
                  </>
                ) : null}
              </Card>
            </Section>
          ) : null}

          <Section
            title="Transactions"
            action={
              data.list.length > LIST_PREVIEW ? (
                <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show less' : `All ${data.list.length}`}
                </Button>
              ) : undefined
            }
          >
            <TransactionList transactions={shown} onSelect={setEdit} emptyText={`No ${kind === 'income' ? 'income' : 'spending'} in ${cat.name} in the last ${win} months.`} />
          </Section>
        </div>
      ) : null}

      <TransactionForm open={Boolean(edit)} onClose={() => setEdit(null)} initial={edit} />
      <TransactionForm open={adding} onClose={() => setAdding(false)} defaultType={kind} presetCategoryId={cat.id} />
      <CategoryForm open={editingCategory} onClose={() => setEditingCategory(false)} initial={cat} kind={kind} parentId={cat.parent_id} />
    </div>
  )
}
