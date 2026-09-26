import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/utils'
import { inputClass } from '@/components/ui/Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} rows={2} className={cn(inputClass, 'h-auto py-3 resize-none', className)} {...rest} />
})
