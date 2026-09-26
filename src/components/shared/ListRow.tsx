import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/utils'

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
}: {
  icon?: LucideIcon
  color?: string
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  chevron?: boolean
  className?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn('flex w-full items-center gap-4 px-5 py-4 text-left transition-colors', onClick && 'hover:bg-surface-2 active:bg-surface-2', className)}
    >
      {Icon ? (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: (color ?? '#64748b') + '22', color: color ?? '#64748b' }}>
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-[13px] text-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right">{trailing}</span> : null}
      {chevron ? <ChevronRight className="h-4 w-4 shrink-0 text-faint" /> : null}
    </Comp>
  )
}
