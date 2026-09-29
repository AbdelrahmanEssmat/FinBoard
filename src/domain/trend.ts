/**
 * Pure helpers for the net-worth trend chart: time ranges, summary stats, a y-axis that shows
 * movement without exaggerating it, and a smooth (monotone) SVG path that never overshoots the data.
 */
import { addDaysIso } from '@/utils/dates'

export interface TrendPoint {
  date: string
  value: number
}

export type RangeKey = '1W' | '1M' | '3M' | '1Y' | 'ALL'
export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1W', label: '1W', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '1Y', label: '1Y', days: 365 },
  { key: 'ALL', label: 'All', days: null },
]

/** Points on or after the start of the range (the same rule the 30-day change has always used). */
export function sliceRange(points: TrendPoint[], range: RangeKey, today: string): TrendPoint[] {
  const days = RANGES.find((r) => r.key === range)?.days ?? null
  if (days === null) return points
  const from = addDaysIso(today, -days)
  return points.filter((p) => p.date >= from)
}

export interface TrendStats {
  start: number
  end: number
  change: number
  changePct: number | null
  high: TrendPoint
  low: TrendPoint
}

export function trendStats(points: TrendPoint[]): TrendStats | null {
  if (!points.length) return null
  const start = points[0]!.value
  const end = points[points.length - 1]!.value
  let high = points[0]!
  let low = points[0]!
  for (const p of points) {
    if (p.value > high.value) high = p
    if (p.value < low.value) low = p
  }
  return { start, end, change: end - start, changePct: start === 0 ? null : ((end - start) / Math.abs(start)) * 100, high, low }
}

