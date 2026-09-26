import type { ReactNode } from 'react'
import { cn } from '@/utils'

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-end justify-between px-1', className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
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
