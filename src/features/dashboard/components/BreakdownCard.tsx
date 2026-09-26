import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { Card, Segmented } from '@/components/ui'
import { Amount } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { d, type Decimal } from '@/domain/money'
import type { NetWorthResult } from '@/domain/networth'

const CLASS_META = [
  { key: 'accounts', label: 'Accounts', color: '#2f6bff' },
  { key: 'certificates', label: 'Certificates', color: '#eab308' },
  { key: 'investments', label: 'Investments', color: '#8b5cf6' },
  { key: 'gold', label: 'Gold', color: '#c08a06' },
  { key: 'receivables', label: 'Owed to me', color: '#16a34a' },
] as const
const CURRENCY_COLORS = ['#2f6bff', '#16a34a', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899']

interface Slice {
  key: string
  label: string
  value: Decimal
  color: string
}

export function BreakdownCard({ nw, display }: { nw: NetWorthResult; display: string }) {
  const [mode, setMode] = useState<'class' | 'currency'>('class')
  const privacy = usePrefs((s) => s.privacy)

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
        <Segmented value={mode} onChange={setMode} options={[{ value: 'class', label: 'Type' }, { value: 'currency', label: 'Currency' }]} className="w-44" />
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
        <ul className="w-full min-w-0 flex-1 space-y-3">
          {slices.map((x) => (
            <li key={x.key} className="flex items-center gap-3 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
              <span className="min-w-0 flex-1 truncate text-muted">
                {x.label} <span className="text-xs text-faint">{total.isZero() ? '' : x.value.div(total).times(100).toFixed(0) + '%'}</span>
              </span>
              <Amount value={x.value} currency={display} className="text-sm font-medium" compact />
            </li>
          ))}
          {nw.byClass.liabilities.gt(0) ? (
            <li className="flex items-center gap-3 border-t border-border pt-3 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-negative" />
              <span className="min-w-0 flex-1 truncate text-muted">I owe</span>
              <Amount value={nw.byClass.liabilities.neg()} currency={display} className="text-sm font-medium text-negative" compact />
            </li>
          ) : null}
        </ul>
      </div>
    </Card>
  )
}
