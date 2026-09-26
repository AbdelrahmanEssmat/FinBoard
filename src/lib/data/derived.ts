import { useMemo } from 'react'
import { buildRateTable, convert, type RateTable } from '@/domain/currency'
import { d, Decimal, type NumericInput } from '@/domain/money'
import { formatMoney, type FormatMoneyOptions, type CurrencyMeta } from '@/domain/format'
import type { GoldPriceTable, Karat } from '@/domain/gold'
import { usePrefs } from '../prefs'
import { useCurrencies, useGoldPrices, useRates, useSettings } from './tables'
import type { GoldPrice } from '../database.types'

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

/** convert(amount, from) → Decimal in the display currency (null when a rate is missing). */
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
  const currencies = useActiveCurrencies()
  const { data: all } = useCurrencies()
  const metas = useMemo(
    () => (all ?? []).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals })).concat(currencies),
    [all, currencies],
  )
  return useMemo(
    () => (value: NumericInput, currency: string, opts: FormatMoneyOptions = {}) => formatMoney(value, currency, { currencies: metas, ...opts }),
    [metas],
  )
}

export function latestGoldPrices(rows: GoldPrice[]): GoldPriceTable & { rows: Partial<Record<Karat, GoldPrice>> } {
  const byKarat: Partial<Record<Karat, GoldPrice>> = {}
  for (const row of rows) {
    const k = row.karat as Karat
    const cur = byKarat[k]
    if (!cur) {
      byKarat[k] = row
      continue
    }
    const newer = row.price_at > cur.price_at || (row.price_at === cur.price_at && row.user_id !== null && cur.user_id === null)
    if (newer) byKarat[k] = row
  }
  const ref = byKarat[21] ?? byKarat[24] ?? byKarat[18]
  const perGram: Partial<Record<Karat, number>> = {}
  for (const k of [24, 22, 21, 18] as Karat[]) if (byKarat[k]) perGram[k] = byKarat[k]!.price_per_gram
  return { perGram, source: ref?.source ?? 'none', sourceName: ref?.source_name ?? null, priceAt: ref?.price_at ?? null, rows: byKarat }
}

export function useGoldPriceTable() {
  const { data } = useGoldPrices()
  return useMemo(() => latestGoldPrices(data ?? []), [data])
}
