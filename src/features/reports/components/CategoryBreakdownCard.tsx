import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Card, Segmented } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import { iconFor } from '@/utils/icons'
import type { CategoryChange, CategoryTotal } from '@/domain/insights'

export function CategoryBreakdownCard({
  kind,
  onKind,
  expense,
  income,
  display,
}: {
  kind: 'expense' | 'income'
  onKind: (k: 'expense' | 'income') => void
  expense: CategoryChange[]
  income: CategoryTotal[]
  display: string
}) {
  const rows: (CategoryTotal & Partial<CategoryChange>)[] = kind === 'expense' ? expense.filter((r) => r.value.gt(0)) : income
  return (
    <Section title="By category" action={<Segmented value={kind} onChange={onKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} className="w-48" />}>
      <Card className="divide-y divide-border">
        {rows.map((r) => {
          const Icon = iconFor(r.icon)
          const change = r.change
          return (
            <div key={r.id} className="flex items-center gap-4 px-5 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: r.color + '22', color: r.color }}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[15px] font-medium">{r.name}</span>
                  <Amount value={r.value} currency={display} className="text-sm font-semibold" />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} />
                  </div>
                  <span className="w-9 text-right text-[11px] text-muted">{r.pct.toFixed(0)}%</span>
                </div>
                {change && !change.isZero() && r.previous && r.previous.gt(0) ? (
                  <div className={`mt-1.5 flex items-center gap-1 text-[11px] ${change.gt(0) ? 'text-negative' : 'text-positive'}`}>
                    {change.gt(0) ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    <Amount value={change.abs()} currency={display} size="sm" className="text-[11px]" /> {change.gt(0) ? 'more' : 'less'} than the previous period
                    {r.changePct ? ` (${r.changePct.abs().toFixed(0)}%)` : ''}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        {!rows.length ? <p className="p-5 text-sm text-muted">No {kind === 'expense' ? 'spending' : 'income'} in this period.</p> : null}
      </Card>
    </Section>
  )
}
