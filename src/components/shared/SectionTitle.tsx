import type { ReactNode } from 'react'
import { cn } from '@/utils'

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2.5 flex min-h-8 items-center justify-between gap-3 px-1', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>
      {action}
    </div>
  )
}

/** A titled block with the standard gap below the title. */
export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </section>
  )
}
