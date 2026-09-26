import { useMemo } from 'react'
import { buildRateTable, convert, type RateTable } from '@/domain/currency'
import { d, Decimal, type NumericInput } from '@/domain/money'
import { formatMoney, type FormatMoneyOptions, type CurrencyMeta } from '@/domain/format'
import { usePrefs } from '@/store/prefs'
import { useCurrencies, useRates, useSettings } from '@/api/queries'

export function useBaseCurrency(): string {
  const { data } = useSettings()
  return data?.base_currency ?? 'EGP'
}

/** The currency totals are shown in: the user's toggle, else the base currency. */
export function useDisplayCurrency(): string {
  const base = useBaseCurrency()
  const override = usePrefs((s) => s.displayCurrency)
  return override ?? base
}

export function useActiveCurrencies(): CurrencyMeta[] {
  const { data } = useCurrencies()
  return useMemo(() => (data ?? []).filter((c) => c.is_active).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals })), [data])
}

export function useRateTable(date?: string): { rates: RateTable; updatedAt: string | null; provider: string | null } {
  const { data } = useRates()
  return useMemo(() => {
    const rows = data ?? []
    const rates = buildRateTable(rows, date)
    const latest = rows.filter((r) => r.source === 'api').sort((a, b) => (a.fetched_at < b.fetched_at ? 1 : -1))[0]
    return { rates, updatedAt: latest?.fetched_at ?? null, provider: latest?.provider ?? null }
  }, [data, date])
}

/** Conversion helpers bound to the current display currency and rate table. */
export function useConvert() {
  const display = useDisplayCurrency()
  const { rates } = useRateTable()
  return useMemo(
    () => ({
      display,
      rates,
      toDisplay: (amount: NumericInput, from: string): Decimal | null => convert(amount, from, display, rates),
      toDisplayOrZero: (amount: NumericInput, from: string): Decimal => convert(amount, from, display, rates) ?? d(0),
      between: (amount: NumericInput, from: string, to: string): Decimal | null => convert(amount, from, to, rates),
    }),
    [display, rates],
  )
}

export function useMoneyFormatter() {
  const { data: all } = useCurrencies()
  const metas = useMemo(() => (all ?? []).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals })), [all])
  return useMemo(
    () => (value: NumericInput, currency: string, opts: FormatMoneyOptions = {}) => formatMoney(value, currency, { currencies: metas, ...opts }),
    [metas],
  )
}
