import { Card } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import type { FixedVariable, Projection, WeekPattern } from '@/domain/insights'
import { formatDate } from '@/domain/format'

/** Fixed vs variable split, run-rate projection and weekday/weekend pattern. */
export function SpendingStructureCard({ fixed, projection, week, display, rangeTo }: { fixed: FixedVariable; projection: Projection | null; week: WeekPattern; display: string; rangeTo: string }) {
  const total = fixed.fixed.plus(fixed.variable)
  if (total.isZero()) return null
  return (
    <Section title="Spending structure">
      <Card padded className="space-y-6">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted">Fixed vs variable</span>
            <span className="text-xs text-faint">{fixed.fixedPct.toFixed(0)}% fixed</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent" style={{ width: `${fixed.fixedPct}%` }} />
            <div className="h-full bg-warning" style={{ width: `${100 - fixed.fixedPct}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full bg-accent" /> Fixed (rent, bills, subscriptions)
              </div>
              <Amount value={fixed.fixed} currency={display} className="font-medium" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2 w-2 rounded-full bg-warning" /> Variable (everything else)
              </div>
              <Amount value={fixed.variable} currency={display} className="font-medium" />
            </div>
          </div>
        </div>

        {projection && projection.daysElapsed < projection.daysInPeriod ? (
          <div className="border-t border-border pt-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted">Month so far</span>
              <span className="text-xs text-faint">
                day {projection.daysElapsed} of {projection.daysInPeriod}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-negative/80" style={{ width: `${(projection.daysElapsed / projection.daysInPeriod) * 100}%` }} />
            </div>
            {/* three figures side by side from 360px; two per row on the smallest phones */}
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm min-[360px]:grid-cols-3">
              <div>
                <div className="text-xs text-muted">Spent</div>
                <Amount value={projection.spentSoFar} currency={display} className="font-medium" compact decimals={0} />
              </div>
              <div>
                <div className="text-xs text-muted">Per day</div>
                <Amount value={projection.avgDaily} currency={display} className="font-medium" compact decimals={0} />
              </div>
              <div>
                <div className="text-xs text-muted">Projected by {formatDate(rangeTo, 'd MMM')}</div>
                <Amount value={projection.projected} currency={display} className="font-medium" compact decimals={0} />
              </div>
            </div>
          </div>
        ) : null}

        {!week.weekdayPerDay.isZero() || !week.weekendPerDay.isZero() ? (
          <div className="border-t border-border pt-5">
            <div className="mb-2 text-sm text-muted">Average per day</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted">Weekdays (Sun–Thu)</div>
                <Amount value={week.weekdayPerDay} currency={display} className="font-medium" />
              </div>
              <div>
                <div className="text-xs text-muted">Weekends (Fri–Sat)</div>
                <Amount value={week.weekendPerDay} currency={display} className="font-medium" />
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </Section>
  )
}
