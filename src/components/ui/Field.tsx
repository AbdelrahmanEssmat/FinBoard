import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@/utils'

/**
 * A label forwards clicks on its text and gaps to its first labelable descendant, and buttons are
 * labelable: with a chip row, colour swatches or a segmented control inside, tapping "Category"
 * (or the space between chips) would press the first one and silently change the value.
 * Cancelling the click stops that forwarding; clicks on the controls themselves are untouched.
 */
function guardLabelClick(e: MouseEvent<HTMLLabelElement>) {
  if (e.currentTarget.control?.tagName !== 'BUTTON') return
  if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return
  e.preventDefault()
}

/** Label + control + hint/error. Wraps its child in a <label> so tapping the label focuses the control. */
export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)} onClick={guardLabelClick}>
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
