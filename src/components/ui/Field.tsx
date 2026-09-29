import { useId, type MouseEvent, type ReactNode } from 'react'
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

/**
 * Label + control + hint/error. Wraps its child in a <label> so tapping the label focuses the
 * control. `group` is for a set of buttons (chips, swatches, a segmented control): the label then
 * names the whole group rather than its first button.
 */
export function Field({ label, hint, error, children, className, group }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string; group?: boolean }) {
  const id = useId()
  const labelEl = label ? (
    <span id={group ? id : undefined} className="mb-2 block text-[13px] font-medium text-muted">
      {label}
    </span>
  ) : null
  const note = error ? <span className="mt-1.5 block text-xs text-negative">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-faint">{hint}</span> : null
  if (group) {
    return (
      <div role="group" aria-labelledby={label ? id : undefined} className={cn('block', className)}>
        {labelEl}
        {children}
        {note}
      </div>
    )
  }
  return (
    <label className={cn('block', className)} onClick={guardLabelClick}>
      {labelEl}
      {children}
      {note}
    </label>
  )
}

/** Vertical rhythm for a form body. */
export function FormStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-5', className)}>{children}</div>
}
