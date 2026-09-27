import { useNavigate } from 'react-router-dom'
import { Droplets } from 'lucide-react'
import { Amount } from '@/components/shared'
import { useLiquidity } from '@/hooks/useLiquidity'
import { cn } from '@/utils'

/**
 * Always-visible liquid money: in the phone top bar (compact) and the desktop sidebar (with the
 * split by currency). Tapping opens the full breakdown.
 */
export function LiquidityChip({ variant = 'bar', className }: { variant?: 'bar' | 'sidebar'; className?: string }) {
  const navigate = useNavigate()
  const l = useLiquidity()
  if (l.isLoading) return null

  if (variant === 'sidebar') {
    return (
      <button onClick={() => navigate('/liquidity')} className={cn('w-full rounded-2xl bg-surface-2 px-4 py-3 text-left transition-colors hover:bg-accent-soft', className)}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <Droplets className="h-3.5 w-3.5 text-accent" /> Liquid now
        </span>
        <Amount value={l.total} currency={l.display} decimals={0} className="mt-1 block text-lg font-semibold" />
        {l.byCurrency.length ? (
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {l.byCurrency.map((c) => (
              <Amount key={c.currency} value={c.amount} currency={c.currency} decimals={0} />
            ))}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <button
      onClick={() => navigate('/liquidity')}
      aria-label="Liquid money"
      className={cn('flex h-10 min-w-0 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-semibold shadow-[var(--shadow-card)] active:bg-surface-2', className)}
    >
      <Droplets className="h-4 w-4 shrink-0 text-accent" />
      <Amount value={l.total} currency={l.display} decimals={0} compact className="truncate" />
    </button>
  )
}
