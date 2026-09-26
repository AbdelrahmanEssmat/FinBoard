import { useActiveCurrencies, useBaseCurrency, useDisplayCurrency } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'

/** Small pill that cycles the display currency through the active list. */
export function CurrencyToggle() {
  const currencies = useActiveCurrencies()
  const base = useBaseCurrency()
  const display = useDisplayCurrency()
  const setDisplay = usePrefs((s) => s.setDisplayCurrency)
  const codes = currencies.map((c) => c.code)
  if (!codes.includes(base)) codes.unshift(base)
  const next = () => {
    const i = codes.indexOf(display)
    const n = codes[(i + 1) % codes.length] ?? base
    setDisplay(n === base ? null : n)
  }
  return (
    <button onClick={next} aria-label="Change display currency" className="flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 text-xs font-semibold text-muted active:scale-95 transition-transform">
      {display}
      {codes.length > 1 ? <span className="text-faint">⇄</span> : null}
    </button>
  )
}
