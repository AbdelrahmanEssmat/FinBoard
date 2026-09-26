import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Field({ label, hint, error, children, className }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      {label ? <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span> : null}
      {children}
      {error ? <span className="mt-1 block text-xs text-negative">{error}</span> : hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'w-full h-11 rounded-xl border border-border bg-surface px-3.5 text-[15px] text-text placeholder:text-faint ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-shadow disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClass, className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} rows={2} className={cn(inputClass, 'h-auto py-2.5 resize-none', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(inputClass, 'appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
    </div>
  )
})

/** Amount input with currency selector on the right. */
export function AmountInput({
  value,
  onChange,
  currency,
  currencies,
  onCurrencyChange,
  autoFocus,
  placeholder = '0.00',
  className,
}: {
  value: string
  onChange: (v: string) => void
  currency: string
  currencies: { code: string; symbol: string }[]
  onCurrencyChange?: (c: string) => void
  autoFocus?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('flex h-12 items-stretch rounded-xl border border-border bg-surface focus-within:ring-2 focus-within:ring-accent/40 focus-within:border-accent transition-shadow', className)}>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))}
        className="tnum min-w-0 flex-1 bg-transparent px-3.5 text-lg font-semibold text-text placeholder:text-faint focus:outline-none"
      />
      {onCurrencyChange ? (
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          className="appearance-none rounded-r-xl border-l border-border bg-surface-2 px-3 text-sm font-medium text-muted focus:outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex items-center border-l border-border bg-surface-2 px-3 text-sm font-medium text-muted rounded-r-xl">{currency}</span>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex rounded-xl bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all',
            o.value === value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
      <span>
        <span className="block text-[15px] text-text">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}>
        <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}
