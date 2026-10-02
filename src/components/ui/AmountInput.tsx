import { cn } from '@/utils'

/** Large amount entry with the currency shown (or selectable) on the right. Never auto-focuses: the keyboard opens only on tap. */
export function AmountInput({
  value,
  onChange,
  currency,
  currencies,
  onCurrencyChange,
  placeholder = '0.00',
  className,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  currency: string
  currencies: { code: string; symbol: string }[]
  onCurrencyChange?: (c: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-14 items-stretch rounded-xl border border-border bg-surface transition-shadow',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40',
        disabled && 'opacity-60',
        className,
      )}
    >
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        enterKeyHint="done"
        disabled={disabled}
        // digits (Arabic-Indic and Persian too), separators and a minus; the amount parser reads the rest
        onChange={(e) => onChange(e.target.value.replace(/[^\d٠-٩۰-۹.,٫٬-]/g, ''))}
        className="tnum min-w-0 flex-1 bg-transparent px-4 text-xl font-semibold text-text placeholder:text-faint focus:outline-none"
      />
      {onCurrencyChange ? (
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          disabled={disabled}
          aria-label="Currency"
          className="appearance-none rounded-r-xl border-l border-border bg-surface-2 px-4 text-[16px] font-semibold text-muted focus:outline-none sm:text-sm"
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
