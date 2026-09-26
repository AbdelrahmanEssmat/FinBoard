import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/utils'

export const inputClass =
  'w-full h-12 rounded-xl border border-border bg-surface px-4 text-[15px] text-text placeholder:text-faint ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-shadow disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClass, className)} {...rest} />
})
