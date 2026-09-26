import { cn } from '@/utils'

/** Large amount entry with the currency shown (or selectable) on the right. */
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
    <div
      className={cn(
        'flex h-14 items-stretch rounded-xl border border-border bg-surface transition-shadow',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40',
        className,
      )}
    >
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))}
        className="tnum min-w-0 flex-1 bg-transparent px-4 text-xl font-semibold text-text placeholder:text-faint focus:outline-none"
      />
      {onCurrencyChange ? (
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          aria-label="Currency"
          className="appearance-none rounded-r-xl border-l border-border bg-surface-2 px-4 text-sm font-semibold text-muted focus:outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex items-center rounded-r-xl border-l border-border bg-surface-2 px-4 text-sm font-semibold text-muted">{currency}</span>
      )}
    </div>
  )
}
