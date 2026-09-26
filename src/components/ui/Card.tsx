import type { HTMLAttributes, ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl bg-surface shadow-[var(--shadow-card)]', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex items-end justify-between px-1', className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {back}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** Tappable list row with optional leading icon disc and trailing content. */
export function ListRow({
  icon: Icon,
  color,
  title,
  subtitle,
  trailing,
  onClick,
  chevron,
  className,
  emoji,
}: {
  icon?: LucideIcon
  color?: string
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  chevron?: boolean
  className?: string
  emoji?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        onClick && 'hover:bg-surface-2 active:bg-surface-2',
        className,
      )}
    >
      {Icon || emoji ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ background: (color ?? '#64748b') + '22', color: color ?? '#64748b' }}>
          {emoji ?? (Icon ? <Icon className="h-5 w-5" /> : null)}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right">{trailing}</span> : null}
      {chevron ? <ChevronRight className="h-4 w-4 shrink-0 text-faint" /> : null}
    </Comp>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('mx-4 h-px bg-border', className)} />
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="anim-fade-up flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent">
        <Icon className="h-7 w-7" />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-xs text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ProgressBar({ value, color, className }: { value: number; color?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(pct)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color ?? 'var(--color-accent)' }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} />
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'accent'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    positive: 'bg-positive-soft text-positive',
    negative: 'bg-negative-soft text-negative',
    warning: 'bg-warning-soft text-warning',
    accent: 'bg-accent-soft text-accent',
  }
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>
}
