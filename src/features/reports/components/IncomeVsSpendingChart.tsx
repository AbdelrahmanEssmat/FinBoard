import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Card } from '@/components/ui'
import { Section } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { formatMoney } from '@/domain/format'
import type { MonthPoint } from '@/domain/insights'

export function IncomeVsSpendingChart({ months, display }: { months: MonthPoint[]; display: string }) {
  const privacy = usePrefs((s) => s.privacy)
  if (months.length < 2) return null
  const data = months.map((m) => ({ month: m.label, income: m.income.toNumber(), expense: m.expense.toNumber() }))
  return (
    <Section title="Income vs spending">
      <Card padded>
        <div className={`h-48 ${privacy ? 'privacy-blur' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={3} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-2)' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg bg-text px-2.5 py-1.5 text-xs text-bg">
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
        <div className="mt-3 flex justify-center gap-5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-positive" /> Income
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-negative" /> Spending
          </span>
        </div>
      </Card>
    </Section>
  )
}
