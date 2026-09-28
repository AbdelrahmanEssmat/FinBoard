import { useMemo, useState } from 'react'
import { Card } from '@/components/ui'
import { Amount } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { formatDate, formatPercent, todayIso } from '@/domain/format'
import type { Decimal } from '@/domain/money'
import { monotonePath, sliceRange, trendStats, yDomain, type TrendPoint } from '@/domain/trend'
import { cn, relativeTime } from '@/utils'
import { daysBetween } from '@/utils/dates'
import type { HistoryPoint } from '@/features/dashboard/useNetWorthHistory'

/** Rates older than this get a quiet note (they normally refresh every few hours). */
const STALE_RATES_HOURS = 26

/** Home: net worth, how it changed over the last month, and a small trend line. */
export function NetWorthCard({ total, history, display, ratesUpdatedAt }: { total: Decimal; history: HistoryPoint[]; display: string; ratesUpdatedAt: string | null }) {
  const privacy = usePrefs((s) => s.privacy)
  const today = todayIso()
  // read the clock once per mount (render itself must stay pure)
  const [now] = useState(() => Date.now())
  const points = useMemo(() => sliceRange(history, '1M', today), [history, today])
  const stats = useMemo(() => trendStats(points), [points])

  const hasTrend = points.length >= 2 && !!stats
  const change = stats?.change ?? 0
  // "no change" when it moved less than 0.05% (rounding, rate wobble), instead of a green +0.0%
  const flat = !stats || Math.abs(change) < Math.max(1, Math.abs(stats.start) * 0.0005)
  const up = !flat && change > 0
  const period = points[0] && daysBetween(points[0].date, today) >= 29 ? 'this month' : points[0] ? `since ${formatDate(points[0].date, 'd MMM')}` : ''
  const ratesStale = ratesUpdatedAt ? now - new Date(ratesUpdatedAt).getTime() > STALE_RATES_HOURS * 3_600_000 : false

  return (
    <Card padded>
      {/* the trend sits beside the label, so the amount keeps the full width on small phones */}
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Net worth</div>
        {hasTrend ? <Sparkline points={points} color={flat ? 'var(--color-faint)' : up ? 'var(--color-positive)' : 'var(--color-negative)'} className={privacy ? 'privacy-blur' : ''} /> : null}
      </div>
      <Amount value={total} currency={display} size="xl" className="mt-1" />
      <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-1.5 text-sm">
        {!hasTrend ? (
          <span className="text-muted">Tracking started today · the trend shows from tomorrow</span>
        ) : flat ? (
          <span className="text-muted">No change {period}</span>
        ) : (
          <>
            <Amount value={change} currency={display} showSign compact className={cn('font-semibold', up ? 'text-positive' : 'text-negative')} />
            <span className={cn('font-medium', up ? 'text-positive' : 'text-negative')}>({formatPercent(stats!.changePct ?? 0)})</span>
            <span className="text-muted">{period}</span>
          </>
        )}
      </div>
      {ratesStale ? <div className="mt-2 text-[11px] text-warning">Exchange rates last updated {relativeTime(ratesUpdatedAt)}</div> : null}
    </Card>
  )
}

/** A small trend line: shape only, no axes (a flat month draws as a flat line in the middle). */
function Sparkline({ points, color, className }: { points: TrendPoint[]; color: string; className?: string }) {
  const W = 88
  const H = 28
  const pad = 3
  const span = Math.max(1, daysBetween(points[0]!.date, points[points.length - 1]!.date))
  const [lo, hi] = yDomain(points.map((p) => p.value))
  const xs = points.map((p) => pad + (daysBetween(points[0]!.date, p.date) / span) * (W - pad * 2))
  const ys = points.map((p) => pad + (1 - (p.value - lo) / (hi - lo)) * (H - pad * 2))
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={cn('shrink-0 overflow-visible', className)} aria-hidden>
      <path d={monotonePath(xs, ys)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={3} fill={color} />
    </svg>
  )
}
