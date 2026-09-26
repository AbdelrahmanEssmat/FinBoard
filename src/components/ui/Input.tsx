import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/utils'

export const inputClass =
  // 16px on phones: anything smaller makes iOS zoom the page when a field is focused
  'w-full h-12 rounded-xl border border-border bg-surface px-4 text-[16px] sm:text-[15px] text-text placeholder:text-faint ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-shadow disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, type, ...rest }, ref) {
  // date pickers render a wide dd/mm/yyyy + icon; tighter padding keeps it from clipping in two-column rows
  return <input ref={ref} type={type} className={cn(inputClass, type === 'date' && 'min-w-0 px-3', className)} {...rest} />
})
