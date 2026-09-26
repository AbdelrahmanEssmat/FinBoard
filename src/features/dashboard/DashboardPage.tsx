import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowDownLeft, ArrowUpRight, Calendar, HandCoins, Percent, PiggyBank, Repeat, Landmark, Gem, TrendingUp } from 'lucide-react'
import { Amount, Card, Divider, ListRow, SectionTitle, Segmented, Skeleton } from '@/components/ui'
import { useCertificates, usePayouts, useRecurring, useSnapshots, useTransactions } from '@/lib/data/tables'
import { useConvert, useRateTable } from '@/lib/data/derived'
import { usePrefs } from '@/lib/prefs'
import { useNetWorth } from './useNetWorth'
import { useDebtViews } from '@/features/debts/hooks'
import { d, Decimal } from '@/domain/money'
import { convert } from '@/domain/currency'
import { formatDate, formatMoney, todayIso } from '@/domain/format'
import { addDaysIso, endOfMonthIso, relativeTime, startOfMonthIso } from '@/lib/utils'
import { upcomingOccurrences } from '@/domain/recurring'
import { daysUntil } from '@/domain/certificates'

const CLASS_META = [
  { key: 'accounts', label: 'Accounts', color: '#2563eb' },
  { key: 'certificates', label: 'Certificates', color: '#eab308' },
  { key: 'investments', label: 'Investments', color: '#8b5cf6' },
  { key: 'gold', label: 'Gold', color: '#ca8a04' },
  { key: 'receivables', label: 'Owed to me', color: '#16a34a' },
] as const
const CURRENCY_COLORS = ['#2563eb', '#16a34a', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899']

export default function DashboardPage() {
  const navigate = useNavigate()
  const nw = useNetWorth()
  const privacy = usePrefs((s) => s.privacy)
  const { display, toDisplayOrZero, rates } = useConvert()
  const { updatedAt } = useRateTable()
  const { data: snapshots } = useSnapshots()
  const { data: txs } = useTransactions({ from: startOfMonthIso(), to: endOfMonthIso() })
  const { data: payouts } = usePayouts()
  const { data: certs } = useCertificates()
  const { data: recurring } = useRecurring()
  const { open: openDebts } = useDebtViews()
  const [breakdown, setBreakdown] = useState<'class' | 'currency'>('class')
  const today = todayIso()

  const month = useMemo(() => {
    let income = d(0)
    let expense = d(0)
    for (const t of txs ?? []) {
      if (t.type === 'income') income = income.plus(toDisplayOrZero(t.amount, t.currency))
      else if (t.type === 'expense') expense = expense.plus(toDisplayOrZero(t.amount, t.currency))
    }
    return { income, expense, savings: income.minus(expense) }
  }, [txs, toDisplayOrZero])

  const history = useMemo(() => {
    const rows = (snapshots ?? []).slice(-365).map((s) => ({ date: s.snapshot_date, value: (convert(s.total, s.base_currency, display, rates) ?? d(s.total)).toNumber() }))
    // include today's live value as the last point
    if (!rows.length || rows[rows.length - 1]!.date !== today) rows.push({ date: today, value: nw.total.toNumber() })
    else rows[rows.length - 1] = { date: today, value: nw.total.toNumber() }
    return rows
  }, [snapshots, display, rates, nw.total, today])
  const monthAgo = history.find((r) => r.date >= addDaysIso(today, -30))
  const change = monthAgo ? nw.total.minus(monthAgo.value) : null

  const classData = CLASS_META.map((m) => ({ ...m, value: nw.byClass[m.key] })).filter((x) => x.value.gt(0))
  const currencyData = Object.entries(nw.byCurrency).filter(([, v]) => v.gt(0)).sort((a, b) => b[1].comparedTo(a[1])).map(([code, value], i) => ({ key: code, label: code, value, color: CURRENCY_COLORS[i % CURRENCY_COLORS.length]! }))
  const donut = breakdown === 'class' ? classData : currencyData
  const donutTotal = donut.reduce((a, x) => a.plus(x.value), d(0))

  // Upcoming 30 days
  const upcoming = useMemo(() => {
    const limit = addDaysIso(today, 30)
    const items: { key: string; date: string; title: string; subtitle: string; amount: Decimal | null; currency: string; icon: typeof Percent; color: string; overdue?: boolean; to: string }[] = []
    const certMap = new Map((certs ?? []).map((c) => [c.id, c]))
    for (const p of payouts ?? []) {
      if (p.status !== 'pending' || p.due_date > limit) continue
      const c = certMap.get(p.certificate_id)
      if (!c || c.is_closed) continue
      items.push({ key: 'p' + p.id, date: p.due_date, title: `${c.name} payout`, subtitle: p.due_date < today ? 'Not logged yet' : 'Certificate interest', amount: d(p.amount), currency: c.currency, icon: Percent, color: '#eab308', overdue: p.due_date < today, to: `/certificates/${c.id}` })
    }
    for (const c of certs ?? []) {
      if (!c.is_closed && c.maturity_date >= today && c.maturity_date <= limit) items.push({ key: 'm' + c.id, date: c.maturity_date, title: `${c.name} matures`, subtitle: `in ${daysUntil(c.maturity_date, today)} days`, amount: d(c.principal), currency: c.currency, icon: Calendar, color: '#0ea5e9', to: `/certificates/${c.id}` })
    }
    for (const x of openDebts) {
      const nxt = x.next
      if (!nxt || nxt.dueDate > limit) continue
      items.push({ key: 'd' + x.id, date: nxt.dueDate, title: x.direction === 'i_owe' ? `Pay ${x.contact?.name ?? ''}` : `${x.contact?.name ?? ''} pays you`, subtitle: 'Installment', amount: nxt.amount.minus(nxt.paid), currency: x.currency, icon: HandCoins, color: x.direction === 'i_owe' ? '#dc2626' : '#16a34a', overdue: nxt.status === 'overdue', to: `/debts/${x.id}` })
    }
    for (const r of recurring ?? []) {
      for (const dt of upcomingOccurrences(r, today, 30).slice(0, 2)) {
        items.push({ key: 'r' + r.id + dt, date: dt, title: r.name, subtitle: r.auto_post ? 'Recurring · auto' : 'Recurring · reminder', amount: d(r.amount), currency: r.currency, icon: Repeat, color: r.type === 'income' ? '#16a34a' : '#f97316', to: '/recurring' })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8)
  }, [payouts, certs, openDebts, recurring, today])

  if (nw.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-44" />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const noData = nw.assets.isZero() && nw.byClass.liabilities.isZero()

  return (
    <div className="anim-fade-up space-y-6">
      {/* Net worth hero */}
      <Card className="overflow-hidden p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Net worth</div>
        <Amount value={nw.total} currency={display} size="xl" className="mt-1 block" />
        <div className="mt-1 flex items-center gap-2 text-sm">
          {change ? (
            <>
              <Amount value={change} currency={display} colored showSign className="font-medium" />
              <span className="text-muted">last 30 days</span>
            </>
          ) : (
            <span className="text-muted">Tracking starts today</span>
          )}
        </div>
        {history.length > 1 ? (
          <div className={`mt-3 -mx-2 h-24 ${privacy ? 'privacy-blur' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  cursor={{ stroke: 'var(--color-border)' }}
                  content={({ active, payload }) => (active && payload?.length ? <div className="rounded-lg bg-text px-2 py-1 text-xs text-bg">{formatDate(payload[0]!.payload.date)} · {formatMoney(payload[0]!.value as number, display)}</div> : null)}
                />
                <Area type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={2} fill="url(#nw)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {updatedAt ? <div className="mt-2 text-[11px] text-faint">Rates updated {relativeTime(updatedAt)}</div> : null}
      </Card>

      {noData ? (
        <Card className="p-5">
          <h3 className="font-semibold">Let’s set things up</h3>
          <p className="mt-1 text-sm text-muted">Add your accounts with their current balances, then certificates, investments and gold. Your net worth appears here as you go.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { to: '/accounts', label: 'Accounts', icon: Landmark },
              { to: '/certificates', label: 'Certificates', icon: Percent },
              { to: '/investments', label: 'Investments', icon: TrendingUp },
              { to: '/gold', label: 'Gold', icon: Gem },
            ].map((l) => (
              <button key={l.to} onClick={() => navigate(l.to)} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium hover:bg-border">
                <l.icon className="h-4 w-4 text-accent" /> {l.label}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Breakdown</h3>
            <Segmented value={breakdown} onChange={setBreakdown} options={[{ value: 'class', label: 'By type' }, { value: 'currency', label: 'By currency' }]} className="w-52" />
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className={`relative h-36 w-36 shrink-0 ${privacy ? 'privacy-blur' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut.map((x) => ({ name: x.label, value: x.value.toNumber() }))} dataKey="value" innerRadius={50} outerRadius={70} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                    {donut.map((x) => (
                      <Cell key={x.key} fill={x.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] uppercase tracking-wide text-muted">Assets</span>
                <Amount value={nw.assets} currency={display} className="text-xs font-semibold" compact symbolStyle="none" />
              </div>
            </div>
            <ul className="w-full min-w-0 flex-1 space-y-2">
              {donut.map((x) => (
                <li key={x.key} className="flex items-center gap-2.5 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {x.label} <span className="text-xs text-faint">{donutTotal.isZero() ? '' : x.value.div(donutTotal).times(100).toFixed(0) + '%'}</span>
                  </span>
                  <Amount value={x.value} currency={display} className="text-sm font-medium" compact />
                </li>
              ))}
              {nw.byClass.liabilities.gt(0) ? (
                <li className="flex items-center gap-2.5 border-t border-border pt-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-negative" />
                  <span className="min-w-0 flex-1 truncate text-muted">I owe</span>
                  <Amount value={nw.byClass.liabilities.neg()} currency={display} className="text-sm font-medium text-negative" compact />
                </li>
              ) : null}
            </ul>
          </div>
        </Card>
      )}

      {/* This month */}
      <section>
        <SectionTitle action={<button onClick={() => navigate('/transactions')} className="text-xs font-medium text-accent">See all</button>}>This month</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3">
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <ArrowDownLeft className="h-3 w-3 text-positive" /> Income
            </div>
            <Amount value={month.income} currency={display} className="mt-1 block text-[15px] font-semibold" compact />
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <ArrowUpRight className="h-3 w-3 text-negative" /> Spending
            </div>
            <Amount value={month.expense} currency={display} className="mt-1 block text-[15px] font-semibold" compact />
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <PiggyBank className="h-3 w-3 text-accent" /> Saved
            </div>
            <Amount value={month.savings} currency={display} colored className="mt-1 block text-[15px] font-semibold" compact />
          </Card>
        </div>
      </section>

      {/* Upcoming */}
      <section>
        <SectionTitle>Upcoming</SectionTitle>
        <Card className="overflow-hidden">
          {upcoming.map((u, i) => (
            <div key={u.key}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                icon={u.icon}
                color={u.color}
                title={u.title}
                subtitle={`${u.overdue ? 'Overdue · ' : ''}${formatDate(u.date)} · ${u.subtitle}`}
                trailing={u.amount ? <Amount value={u.amount} currency={u.currency} className={`font-medium ${u.overdue ? 'text-negative' : ''}`} /> : null}
                onClick={() => navigate(u.to)}
                chevron
              />
            </div>
          ))}
          {!upcoming.length ? <p className="p-4 text-sm text-muted">Nothing due in the next 30 days.</p> : null}
        </Card>
      </section>
    </div>
  )
}
