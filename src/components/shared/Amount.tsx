import type { ReactNode } from 'react'
import { usePrefs } from '@/store/prefs'
import { useMoneyFormatter } from '@/hooks/useMoney'
import { d, type NumericInput } from '@/domain/money'
import type { FormatMoneyOptions } from '@/domain/format'
import { cn } from '@/utils'

/** Money display that respects the privacy toggle and colours by sign when asked. */
export function Amount({
  value,
  currency,
  className,
  colored,
  size,
  ...opts
}: { value: NumericInput; currency: string; className?: string; colored?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl' } & FormatMoneyOptions) {
  const privacy = usePrefs((s) => s.privacy)
  const fmt = useMoneyFormatter()
  const n = d(value)
  const sizeClass = size === 'xl' ? 'text-4xl font-semibold tracking-tight' : size === 'lg' ? 'text-2xl font-semibold' : size === 'sm' ? 'text-sm' : ''
  const color = colored ? (n.gt(0) ? 'text-positive' : n.lt(0) ? 'text-negative' : 'text-muted') : ''
  return (
    <span className={cn('tnum whitespace-nowrap', sizeClass, color, privacy && 'privacy-blur', className)} aria-label={privacy ? 'hidden amount' : undefined}>
      {privacy ? '•••••' : fmt(n, currency, opts)}
    </span>
  )
}

/** Blur arbitrary content when privacy mode is on. */
export function Private({ children, className }: { children: ReactNode; className?: string }) {
  const privacy = usePrefs((s) => s.privacy)
  return <span className={cn(privacy && 'privacy-blur', className)}>{children}</span>
}
