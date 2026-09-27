import { Percent } from 'lucide-react'
import { Card, Divider } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import type { PartyTotal } from '@/domain/categoryStats'
import type { Decimal } from '@/domain/money'

/** Who pays you (venues, clients, employers: the income "From" field), plus passive interest. */
export function IncomeSourcesCard({ sources, unnamed, interest, display }: { sources: PartyTotal[]; unnamed: Decimal; interest: Decimal; display: string }) {
  if (!sources.length && !interest.gt(0)) return null
  const max = sources[0]?.value
  return (
    <Section title="Income sources">
      <Card className="overflow-hidden">
        {sources.map((s, i) => (
          <div key={s.name}>
            {i > 0 ? <Divider /> : null}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium">{s.name}</span>
                <Amount value={s.value} currency={display} className="shrink-0 text-sm font-semibold" />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-positive" style={{ width: `${max && max.gt(0) ? s.value.div(max).times(100).toNumber() : 0}%` }} />
                </div>
                <span className="w-20 text-right text-[11px] text-muted">
                  {s.pct.toFixed(0)}% · {s.count} payment{s.count === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        ))}
        {interest.gt(0) ? (
          <>
            {sources.length ? <Divider /> : null}
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
                <Percent className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">Interest</div>
                <div className="text-xs text-muted">Certificates and Clouds, earned without work</div>
              </div>
              <Amount value={interest} currency={display} className="shrink-0 text-sm font-semibold" />
            </div>
          </>
        ) : null}
        {unnamed.gt(0) && sources.length ? (
          <>
            <Divider />
            <p className="px-5 py-3 text-xs text-muted">
              <Amount value={unnamed} currency={display} size="sm" className="text-xs" /> of income has no “From” name. Add one when you record income to see who it came from.
            </p>
          </>
        ) : null}
      </Card>
    </Section>
  )
}
