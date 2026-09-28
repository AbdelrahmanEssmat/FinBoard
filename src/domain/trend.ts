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

/**
 * Y range for the chart. The line fills the height when it moves, but a tiny wobble is not blown up
 * into a cliff: the visible span is at least 2% of the value.
 */
export function yDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1]
  let min = Math.min(...values)
  let max = Math.max(...values)
  const scale = Math.max(Math.abs(min), Math.abs(max))
  const minSpan = Math.max(scale * 0.02, 1)
  if (max - min < minSpan) {
    const mid = (max + min) / 2
    min = mid - minSpan / 2
    max = mid + minSpan / 2
  }
  const pad = (max - min) * 0.12
  return [min - pad, max + pad]
}

/** Smooth path through the points (Fritsch–Carlson monotone cubic): no bumps above or below the data. */
export function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length
  if (!n) return ''
  if (n === 1) return `M${xs[0]},${ys[0]}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1]! - xs[i]!)
    m.push(dx[i] === 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx[i]!)
  }
  const t: number[] = [m[0]!]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2)
  t.push(m[n - 2]!)
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i]! / m[i]!
    const b = t[i + 1]! / m[i]!
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      t[i] = k * a * m[i]!
      t[i + 1] = k * b * m[i]!
    }
  }
  let d = `M${xs[0]},${ys[0]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3
    d += ` C${xs[i]! + h},${ys[i]! + t[i]! * h} ${xs[i + 1]! - h},${ys[i + 1]! - t[i + 1]! * h} ${xs[i + 1]},${ys[i + 1]}`
  }
  return d
}
