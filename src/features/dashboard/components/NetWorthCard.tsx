import { useEffect, useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import { Card } from '@/components/ui'
import { Amount } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { formatDate, formatPercent, todayIso } from '@/domain/format'
import type { Decimal } from '@/domain/money'
import { availableRanges, RANGES, sliceRange, trendStats, type RangeKey } from '@/domain/trend'
import { cn, relativeTime } from '@/utils'
import { daysBetween } from '@/utils/dates'
import { TrendChart } from '@/features/dashboard/components/TrendChart'
import type { HistoryPoint } from '@/features/dashboard/useNetWorthHistory'

const RANGE_WORDS: Record<RangeKey, string> = { '1W': 'past week', '1M': 'past month', '3M': 'past 3 months', '1Y': 'past year', ALL: 'all time' }

export function NetWorthCard({ total, history, display, ratesUpdatedAt }: { total: Decimal; history: HistoryPoint[]; display: string; ratesUpdatedAt: string | null }) {
  const privacy = usePrefs((s) => s.privacy)
  const today = todayIso()
  const ranges = useMemo(() => availableRanges(history, today), [history, today])
  const [range, setRange] = useState<RangeKey>('1M')
  const [scrub, setScrub] = useState<number | null>(null)

  // fall back to the widest range there is data for (e.g. only a week of history yet)
  const effective: RangeKey | null = ranges.includes(range) ? range : (ranges[ranges.length - 1] ?? null)
  const points = useMemo(() => (effective ? sliceRange(history, effective, today) : history), [history, effective, today])
  const stats = useMemo(() => trendStats(points), [points])
  useEffect(() => setScrub(null), [effective])

  const scrubbed = scrub !== null ? points[scrub] : undefined
  const shownValue = scrubbed ? scrubbed.value : total
  const change = stats ? (scrubbed ? scrubbed.value - stats.start : stats.change) : 0
  const changePct = stats && stats.start !== 0 ? (change / Math.abs(stats.start)) * 100 : null
  const up = change > 0.005
  const down = change < -0.005
  const color = up ? 'var(--color-positive)' : down ? 'var(--color-negative)' : 'var(--color-accent)'
  const hasChart = points.length >= 2 && !!effective
  // with less history than the range (e.g. 2 days on 1W), say where it really starts
  const rangeDays = RANGES.find((r) => r.key === effective)?.days ?? null
  const since = points[0] ? `since ${formatDate(points[0].date, 'd MMM')}` : ''
  const rangeLabel = effective && rangeDays !== null && points[0] && daysBetween(points[0].date, today) >= rangeDays - 1 ? RANGE_WORDS[effective] : effective === 'ALL' ? RANGE_WORDS.ALL : since

  return (
    <Card padded className="overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Net worth</div>
        {scrubbed ? <div className="text-xs font-medium text-muted">{formatDate(scrubbed.date, 'EEE d MMM yyyy')}</div> : null}
      </div>
      <Amount value={shownValue} currency={display} size="xl" className="mt-1.5 block" />

      <div className="mt-2 flex min-h-6 items-center gap-2 text-sm">
        {hasChart ? (
          <>
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', up ? 'bg-positive-soft text-positive' : down ? 'bg-negative-soft text-negative' : 'bg-surface-2 text-muted')}>
              {up ? '▲' : down ? '▼' : '•'} {changePct !== null ? formatPercent(Math.abs(changePct)).replace('+', '') : '0%'}
            </span>
            <Amount value={change} currency={display} showSign className={cn('font-medium', up ? 'text-positive' : down ? 'text-negative' : 'text-muted')} />
            <span className="truncate text-muted">{scrubbed ? since : rangeLabel}</span>
          </>
        ) : (
          <span className="text-muted">Tracking started today</span>
        )}
      </div>

      {hasChart ? (
        <>
          <div className={cn('-mx-1 mt-5', privacy && 'privacy-blur')}>
            <TrendChart points={points} color={color} animateKey={`${effective}-${points.length}`} onScrub={setScrub} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            {ranges.length > 1 ? (
              <div className="flex gap-1" role="tablist" aria-label="Time range">
                {RANGES.filter((r) => ranges.includes(r.key)).map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    role="tab"
                    aria-selected={r.key === effective}
                    onClick={() => setRange(r.key)}
                    className={cn('h-8 min-w-10 rounded-full px-3 text-xs font-semibold transition-colors', r.key === effective ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted">Drag across the chart to see each day</span>
            )}
          </div>

          {stats ? (
            <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-2xl bg-surface-2/60 py-3 text-center">
              <MiniStat label="High" value={<Amount value={stats.high.value} currency={display} compact decimals={0} />} />
              <MiniStat label="Low" value={<Amount value={stats.low.value} currency={display} compact decimals={0} />} />
              <MiniStat
                label="Change"
                value={<span className={cn(stats.change > 0.005 ? 'text-positive' : stats.change < -0.005 ? 'text-negative' : '')}>{stats.changePct !== null ? formatPercent(stats.changePct) : '—'}</span>}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <LineChart className="h-5 w-5" />
          </span>
          <p className="text-xs leading-relaxed text-muted">Your trend line appears here from tomorrow. FinBoard records your net worth each day you open the app.</p>
        </div>
      )}

      {ratesUpdatedAt ? <div className="mt-4 text-[11px] text-faint">Rates updated {relativeTime(ratesUpdatedAt)}</div> : null}
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 px-2">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  )
}
