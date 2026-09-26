import type { ReactNode } from 'react'
import { cn } from '@/utils'

/** Label + control + hint/error. Wraps its child in a <label> so tapping the label focuses the control. */
export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      {label ? <span className="mb-2 block text-[13px] font-medium text-muted">{label}</span> : null}
      {children}
      {error ? <span className="mt-1.5 block text-xs text-negative">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-faint">{hint}</span> : null}
    </label>
  )
}

/** Vertical rhythm for a form body. */
export function FormStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-5', className)}>{children}</div>
}
