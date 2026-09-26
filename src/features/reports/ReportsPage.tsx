import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { ChevronLeft } from 'lucide-react'
import { Amount, Card, PageHeader, SectionTitle, Segmented, Select } from '@/components/ui'
import { useAccounts, useCategories, useSubAccounts, useTransactions } from '@/lib/data/tables'
import { useConvert } from '@/lib/data/derived'
import { usePrefs } from '@/lib/prefs'
import { byId, endOfMonthIso, startOfMonthIso } from '@/lib/utils'
import { d, Decimal } from '@/domain/money'
import { formatMoney } from '@/domain/format'
import { iconFor } from '@/lib/icons'

type Range = '1' | '3' | '6' | '12'

export default function ReportsPage() {
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('3')
  const [accountId, setAccountId] = useState('')
  const [tag, setTag] = useState('')
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const privacy = usePrefs((s) => s.privacy)
  const months = Number(range)
  const now = new Date()
  const from = startOfMonthIso(new Date(now.getFullYear(), now.getMonth() - months + 1, 1))
  const to = endOfMonthIso(now)
  const { data: txs } = useTransactions({ from, to })
  const { data: categories } = useCategories()
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const { toDisplayOrZero, display } = useConvert()
  const catMap = useMemo(() => byId(categories), [categories])
  const subMap = useMemo(() => byId(subs), [subs])

  const filtered = useMemo(
    () =>
      (txs ?? []).filter((t) => {
        if (t.type === 'transfer') return false
        if (accountId && subMap.get(t.sub_account_id)?.account_id !== accountId) return false
        if (tag && !t.tags.includes(tag)) return false
        return true
      }),
    [txs, accountId, tag, subMap],
  )
  const allTags = useMemo(() => Array.from(new Set((txs ?? []).flatMap((t) => t.tags))).sort(), [txs])

  // per month income vs expense
  const perMonth = useMemo(() => {
    const map = new Map<string, { month: string; income: Decimal; expense: Decimal }>()
    for (let i = months - 1; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = startOfMonthIso(dt).slice(0, 7)
      map.set(key, { month: dt.toLocaleDateString('en-GB', { month: 'short' }), income: d(0), expense: d(0) })
    }
    for (const t of filtered) {
      const e = map.get(t.date.slice(0, 7))
      if (!e) continue
      const v = toDisplayOrZero(t.amount, t.currency)
      if (t.type === 'income') e.income = e.income.plus(v)
      else e.expense = e.expense.plus(v)
    }
    return Array.from(map.values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, months, toDisplayOrZero])

  // by category (parents aggregate children)
  const byCategory = useMemo(() => {
    const map = new Map<string, Decimal>()
    for (const t of filtered) {
      if (t.type !== kind) continue
      const cat = t.category_id ? catMap.get(t.category_id) : undefined
      const key = cat?.parent_id ?? cat?.id ?? 'none'
      map.set(key, (map.get(key) ?? d(0)).plus(toDisplayOrZero(t.amount, t.currency)))
    }
    const total = Array.from(map.values()).reduce((a, v) => a.plus(v), d(0))
    return {
      total,
      rows: Array.from(map.entries())
        .map(([id, value]) => ({ id, cat: catMap.get(id), value, pct: total.isZero() ? 0 : value.div(total).times(100).toNumber() }))
        .sort((a, b) => b.value.comparedTo(a.value)),
    }
  }, [filtered, kind, catMap, toDisplayOrZero])

  const totals = perMonth.reduce((a, m) => ({ income: a.income.plus(m.income), expense: a.expense.plus(m.expense) }), { income: d(0), expense: d(0) })
  const avgExpense = months ? totals.expense.div(months) : d(0)

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Reports"
      />
      <div className="mb-4 space-y-3">
        <Segmented value={range} onChange={setRange} options={[{ value: '1', label: 'This month' }, { value: '3', label: '3 mo' }, { value: '6', label: '6 mo' }, { value: '12', label: '12 mo' }]} />
        <div className="grid grid-cols-2 gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Card className="p-3">
          <div className="text-[11px] text-muted">Income</div>
          <Amount value={totals.income} currency={display} className="block text-[15px] font-semibold text-positive" compact />
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted">Spending</div>
          <Amount value={totals.expense} currency={display} className="block text-[15px] font-semibold text-negative" compact />
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted">Avg / month</div>
          <Amount value={avgExpense} currency={display} className="block text-[15px] font-semibold" compact />
        </Card>
      </div>

      {months > 1 ? (
        <section className="mb-6">
          <SectionTitle>Income vs spending</SectionTitle>
          <Card className="p-4">
            <div className={`h-44 ${privacy ? 'privacy-blur' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perMonth.map((m) => ({ month: m.month, income: m.income.toNumber(), expense: m.expense.toNumber() }))} barGap={2} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                  <Tooltip
                    cursor={{ fill: 'var(--color-surface-2)' }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg bg-text px-2 py-1 text-xs text-bg">
                          <div className="font-medium">{label}</div>
                          <div>In {formatMoney(payload.find((p) => p.dataKey === 'income')?.value as number, display)}</div>
                          <div>Out {formatMoney(payload.find((p) => p.dataKey === 'expense')?.value as number, display)}</div>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="income" fill="var(--color-positive)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="expense" fill="var(--color-negative)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-positive" /> Income
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-negative" /> Spending
              </span>
            </div>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle action={<Segmented value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} className="w-44" />}>By category</SectionTitle>
        <Card className="divide-y divide-border">
          {byCategory.rows.map((r) => {
            const Icon = iconFor(r.cat?.icon)
            const color = r.cat?.color ?? '#94a3b8'
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: color + '22', color }}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[15px] font-medium">{r.cat?.name ?? 'Uncategorised'}</span>
                    <Amount value={r.value} currency={display} className="text-sm font-semibold" />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: color }} />
                    </div>
                    <span className="w-9 text-right text-[11px] text-muted">{r.pct.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            )
          })}
          {!byCategory.rows.length ? <p className="p-4 text-sm text-muted">No {kind === 'expense' ? 'spending' : 'income'} in this period.</p> : null}
        </Card>
      </section>
    </div>
  )
}
