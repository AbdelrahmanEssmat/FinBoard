import type { HTMLAttributes } from 'react'
import { cn } from '@/utils'

/**
 * Surface container. `padded` applies the standard inner padding; list-style
 * cards leave it off and let rows carry their own spacing.
 */
export function Card({ className, children, padded, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn('rounded-2xl bg-surface shadow-[var(--shadow-card)]', padded && 'p-5 sm:p-6', className)} {...rest}>
      {children}
    </div>
  )
}

/** Hairline between rows. Above an icon row it is inset to align with the row's text (CSS in styles/index.css). */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider mx-5 h-px bg-border', className)} />
}
