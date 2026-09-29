import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { ChevronRight } from 'lucide-react'
import { Card, Segmented } from '@/components/ui'
import { Amount } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { d, type Decimal } from '@/domain/money'
import type { NetWorthResult } from '@/domain/networth'

/** Each asset class and the page that lists what is inside it. */
const CLASS_META = [
  { key: 'accounts', label: 'Accounts', color: '#2f6bff', to: '/accounts' },
  { key: 'certificates', label: 'Certificates', color: '#eab308', to: '/certificates' },
  { key: 'clouds', label: 'Clouds', color: '#06b6d4', to: '/investments' },
  { key: 'investments', label: 'Investments', color: '#8b5cf6', to: '/investments' },
  { key: 'gold', label: 'Gold', color: '#c08a06', to: '/gold' },
  { key: 'receivables', label: 'Owed to me', color: '#16a34a', to: '/debts' },
] as const
const CURRENCY_COLORS = ['#2f6bff', '#16a34a', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899']

interface Slice {
  key: string
  label: string
  value: Decimal
  color: string
  to?: string
}

export function BreakdownCard({ nw, display }: { nw: NetWorthResult; display: string }) {
  const [mode, setMode] = useState<'class' | 'currency'>('class')
  const privacy = usePrefs((s) => s.privacy)
  const navigate = useNavigate()

  const byClass: Slice[] = CLASS_META.map((m) => ({ ...m, value: nw.byClass[m.key] })).filter((x) => x.value.gt(0))
  const byCurrency: Slice[] = Object.entries(nw.byCurrency)
    .filter(([, v]) => v.gt(0))
    .sort((a, b) => b[1].comparedTo(a[1]))
    .map(([code, value], i) => ({ key: code, label: code, value, color: CURRENCY_COLORS[i % CURRENCY_COLORS.length]! }))
  const slices = mode === 'class' ? byClass : byCurrency
  const total = slices.reduce((a, x) => a.plus(x.value), d(0))

  return (
    <Card padded>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Breakdown</h3>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'class', label: 'Type' }, { value: 'currency', label: 'Currency' }]} className="w-40 min-[360px]:w-44" />
      </div>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
        <div className={`relative h-40 w-40 shrink-0 ${privacy ? 'privacy-blur' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices.map((x) => ({ name: x.label, value: x.value.toNumber() }))} dataKey="value" innerRadius={56} outerRadius={78} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                {slices.map((x) => (
                  <Cell key={x.key} fill={x.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-wide text-muted">Assets</span>
            <Amount value={nw.assets} currency={display} className="text-sm font-semibold" compact symbolStyle="none" />
          </div>
        </div>
        <ul className="-mx-2 w-full min-w-0 flex-1 space-y-0.5">
          {slices.map((x) => {
            const content = (
              <>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                <span className="min-w-0 flex-1 truncate text-left text-muted">
                  {x.label} <span className="text-xs text-faint">{total.isZero() ? '' : x.value.div(total).times(100).toFixed(0) + '%'}</span>
                </span>
                <Amount value={x.value} currency={display} className="text-sm font-medium" compact />
                {x.to ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
              </>
            )
            return (
              <li key={x.key}>
                {x.to ? (
                  // opens the page that lists what makes up this number
                  <button onClick={() => navigate(x.to!)} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 text-sm hover:bg-surface-2 active:bg-surface-2">
                    {content}
                  </button>
                ) : (
                  <div className="flex min-h-10 items-center gap-3 px-2 text-sm">{content}</div>
                )}
              </li>
            )
          })}
          {nw.byClass.cards.gt(0) ? (
            // what's owed on credit cards (subtracted from net worth), opens Accounts where the cards are
            <li className="border-t border-border pt-1">
              <button onClick={() => navigate('/accounts')} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 text-sm hover:bg-surface-2 active:bg-surface-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-negative" />
                <span className="min-w-0 flex-1 truncate text-left text-muted">Credit cards</span>
                <Amount value={nw.byClass.cards.neg()} currency={display} className="text-sm font-medium text-negative" compact />
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
              </button>
            </li>
          ) : null}
          {nw.byClass.liabilities.gt(0) ? (
            <li className={nw.byClass.cards.gt(0) ? '' : 'border-t border-border pt-1'}>
              <button onClick={() => navigate('/debts?tab=i_owe')} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 text-sm hover:bg-surface-2 active:bg-surface-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-negative" />
                <span className="min-w-0 flex-1 truncate text-left text-muted">I owe</span>
                <Amount value={nw.byClass.liabilities.neg()} currency={display} className="text-sm font-medium text-negative" compact />
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </Card>
  )
}
