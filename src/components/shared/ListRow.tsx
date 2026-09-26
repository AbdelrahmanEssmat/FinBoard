import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/utils'

/**
 * Tappable list row with optional leading icon disc and trailing content.
 * Rows with an icon carry `data-icon-row`, which makes the divider above them start
 * at the text rather than the card edge (see `.divider` in styles/index.css).
 */
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
      data-icon-row={Icon ? '' : undefined}
      className={cn('flex min-h-[3.75rem] w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors', onClick && 'hover:bg-surface-2 active:bg-surface-2', className)}
    >
      {Icon ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: (color ?? '#64748b') + '22', color: color ?? '#64748b' }}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right text-[15px] leading-5">{trailing}</span> : null}
      {chevron ? <ChevronRight className="-mr-1 h-4 w-4 shrink-0 text-faint" /> : null}
    </Comp>
  )
}
