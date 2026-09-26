import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { daysBetween } from '@/utils/dates'
import { monotonePath, yDomain, type TrendPoint } from '@/domain/trend'

const PAD_X = 6
const PAD_TOP = 10
const PAD_BOTTOM = 6

/**
 * Hand-drawn SVG trend line. Drag (or hover) to scrub: `onScrub` reports the index under the
 * finger, or null when released. Points are placed by date, so gaps between snapshots stay honest.
 */
export function TrendChart({ points, color, height = 132, animateKey, onScrub }: { points: TrendPoint[]; color: string; height?: number; animateKey: string; onScrub: (index: number | null) => void }) {
  const id = useId().replace(/:/g, '')
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    if (!width || points.length < 2) return null
    const span = Math.max(1, daysBetween(points[0]!.date, points[points.length - 1]!.date))
    const [lo, hi] = yDomain(points.map((p) => p.value))
    const innerW = width - PAD_X * 2
    const innerH = height - PAD_TOP - PAD_BOTTOM
    const xs = points.map((p) => PAD_X + (daysBetween(points[0]!.date, p.date) / span) * innerW)
    const y = (v: number) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * innerH
    const ys = points.map((p) => y(p.value))
    const line = monotonePath(xs, ys)
    const area = `${line} L${xs[xs.length - 1]},${height} L${xs[0]},${height} Z`
    return { xs, ys, line, area, baseY: ys[0]! }
  }, [points, width, height])

  // a new range or data set clears any stale scrub position
  useEffect(() => setActive(null), [animateKey])

  const pick = (clientX: number) => {
    if (!geo || !wrap.current) return
    const x = clientX - wrap.current.getBoundingClientRect().left
    let best = 0
    for (let i = 1; i < geo.xs.length; i++) if (Math.abs(geo.xs[i]! - x) < Math.abs(geo.xs[best]! - x)) best = i
    if (best !== active) {
      setActive(best)
      onScrub(best)
    }
  }
  const release = () => {
    setActive(null)
    onScrub(null)
  }

  const last = geo ? geo.xs.length - 1 : 0
  const at = active ?? last

  return (
    <div
      ref={wrap}
      className="relative w-full select-none"
      style={{ height, touchAction: 'pan-y' }}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e.clientX) : undefined)}
      onPointerUp={(e) => (e.pointerType === 'mouse' ? undefined : release())}
      onPointerLeave={release}
      onPointerCancel={release}
      role="img"
      aria-label="Net worth over time. Drag across the chart to see each day."
    >
      {geo ? (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="70%" stopColor={color} stopOpacity={0.05} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`stroke-${id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={1} />
            </linearGradient>
          </defs>

          {/* where the range started: above it is gain, below it is loss */}
          <line x1={PAD_X} x2={width - PAD_X} y1={geo.baseY} y2={geo.baseY} stroke="var(--color-faint)" strokeOpacity={0.55} strokeDasharray="2 5" strokeLinecap="round" />

          <g key={animateKey}>
            <path d={geo.area} fill={`url(#fill-${id})`} className="trend-fill" />
            <path d={geo.line} fill="none" stroke={`url(#stroke-${id})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="trend-draw" />
          </g>

          {active !== null ? (
            <line x1={geo.xs[at]} x2={geo.xs[at]} y1={0} y2={height} stroke="var(--color-muted)" strokeOpacity={0.45} strokeWidth={1} />
          ) : null}

          {/* the current point pulses; a scrubbed point gets a solid marker */}
          <g transform={`translate(${geo.xs[at]},${geo.ys[at]})`}>
            {active === null ? <circle r={10} fill={color} className="trend-ping" /> : null}
            <circle r={active === null ? 4.5 : 5.5} fill={color} stroke="var(--color-surface)" strokeWidth={2.5} />
          </g>
        </svg>
      ) : null}
    </div>
  )
}
