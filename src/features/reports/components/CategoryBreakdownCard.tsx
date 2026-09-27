import { useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { Card, Segmented } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import { iconFor } from '@/utils/icons'
import { cn } from '@/utils'
import type { CategoryChange } from '@/domain/insights'

/** Totals per category for the period, with the change vs the previous one. Tap a row for details. */
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
  income: CategoryChange[]
  display: string
}) {
  const navigate = useNavigate()
  const rows = (kind === 'expense' ? expense : income).filter((r) => r.value.gt(0)).sort((a, b) => b.value.comparedTo(a.value))
  return (
    <Section title="By category" action={<Segmented value={kind} onChange={onKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} className="w-48" />}>
      <Card className="divide-y divide-border overflow-hidden">
        {rows.map((r) => {
          const Icon = iconFor(r.icon)
          const change = r.change
          // more income is good news; more spending is not
          const good = kind === 'income' ? change.gt(0) : change.lt(0)
          const open = r.id !== 'none' ? () => navigate(`/categories/${r.id}`) : undefined
          const Row = open ? 'button' : 'div'
          return (
            <Row key={r.id} onClick={open} className={cn('flex w-full items-center gap-4 px-5 py-4 text-left', open && 'transition-colors hover:bg-surface-2 active:bg-surface-2')}>
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
                  <span className="w-16 text-right text-[11px] text-muted">
                    {r.pct.toFixed(0)}% · {r.count}×
                  </span>
                </div>
                {!change.isZero() && r.previous.gt(0) ? (
                  <div className={cn('mt-1.5 flex items-center gap-1 text-[11px]', good ? 'text-positive' : 'text-negative')}>
                    {change.gt(0) ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                    <Amount value={change.abs()} currency={display} size="sm" className="text-[11px]" />
                    <span className="truncate">
                      {change.gt(0) ? 'more' : 'less'} than before{r.changePct ? ` (${r.changePct.abs().toFixed(0)}%)` : ''}
                    </span>
                  </div>
                ) : r.previous.isZero() ? (
                  <div className="mt-1.5 text-[11px] text-muted">new this period</div>
                ) : null}
              </div>
              {open ? <ChevronRight className="-mr-1 h-4 w-4 shrink-0 text-faint" /> : null}
            </Row>
          )
        })}
        {!rows.length ? <p className="p-5 text-sm text-muted">No {kind === 'expense' ? 'spending' : 'income'} in this period.</p> : null}
      </Card>
    </Section>
  )
}
