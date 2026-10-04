import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { usePrefs } from '@/store/prefs'
import { useMoneyFormatter } from '@/hooks/useMoney'
import { d, type NumericInput } from '@/domain/money'
import type { FormatMoneyOptions } from '@/domain/format'
import { cn } from '@/utils'
import { HIDDEN } from '@/domain/privacy'

/**
 * Money display that respects the privacy toggle and colours by sign when asked.
 *
 * The large sizes (lg, xl) are headline figures on their own line: they never spill out of their
 * box. When a long number (E£ 12,345,678.90 on a small phone) is wider than the space, the font
 * steps down just enough to fit; short numbers keep the full size. `fit` asks for the same on any
 * size (a stat tile), going down to 12px.
 */
export function Amount({
  value,
  currency,
  className,
  colored,
  size,
  fit: fitProp,
  ...opts
}: { value: NumericInput; currency: string; className?: string; colored?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl'; fit?: boolean } & FormatMoneyOptions) {
  const privacy = usePrefs((s) => s.privacy)
  const fmt = useMoneyFormatter()
  const n = d(value)
  const text = privacy ? HIDDEN : fmt(n, currency, opts)
  const headline = size === 'xl' || size === 'lg'
  const fit = headline || Boolean(fitProp)
  const ref = useFitText<HTMLSpanElement>(fit, text, headline ? 14 : 12)
  const sizeClass = size === 'xl' ? 'text-4xl font-semibold tracking-tight' : size === 'lg' ? 'text-2xl font-semibold' : size === 'sm' ? 'text-sm' : ''
  const color = colored ? (n.gt(0) ? 'text-positive' : n.lt(0) ? 'text-negative' : 'text-muted') : ''
  return (
    // min-w-0: inside a flex row a span would otherwise refuse to shrink, and nothing would ever fit
    <span ref={ref} className={cn('tnum whitespace-nowrap', fit && 'block min-w-0 max-w-full', sizeClass, color, className)} aria-label={privacy ? 'hidden amount' : undefined}>
      {text}
    </span>
  )
}

/** Shrink a single-line block's font until its text fits its width (re-checked when the space changes). */
function useFitText<T extends HTMLElement>(enabled: boolean, text: string, floor: number) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const fitNow = () => {
      el.style.fontSize = ''
      if (!el.clientWidth || el.scrollWidth <= el.clientWidth) return
      const full = parseFloat(getComputedStyle(el).fontSize)
      el.style.fontSize = `${Math.max(floor, Math.floor(full * (el.clientWidth / el.scrollWidth) * 0.98))}px`
    }
    fitNow()
    const ro = new ResizeObserver(fitNow)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [enabled, text, floor])
  return ref
}

/** Content with numbers in it (units, grams, prices): shown as **** when privacy mode is on. */
export function Private({ children, className }: { children: ReactNode; className?: string }) {
  const privacy = usePrefs((s) => s.privacy)
  return <span className={className} aria-label={privacy ? 'hidden' : undefined}>{privacy ? HIDDEN : children}</span>
}
