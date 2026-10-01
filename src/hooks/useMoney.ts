import { useMemo } from 'react'
import { buildRateTable, convert, DEFAULT_CURRENCY, rateResolver, type RateTable } from '@/domain/currency'
import { d, Decimal, type NumericInput } from '@/domain/money'
import { formatMoney, type FormatMoneyOptions, type CurrencyMeta } from '@/domain/format'
import { usePrefs } from '@/store/prefs'
import { useCertificates, useCurrencies, useDebts, useHoldings, useRates, useSettings, useSubAccounts } from '@/api/queries'

export function useBaseCurrency(): string {
  const { data } = useSettings()
  return data?.base_currency ?? DEFAULT_CURRENCY
}

/** The currency totals are shown in: the user's toggle, else the base currency. */
export function useDisplayCurrency(): string {
  const base = useBaseCurrency()
  const override = usePrefs((s) => s.displayCurrency)
  return override ?? base
}

/**
 * Active currencies plus any switched off but still holding money (a balance, holding, certificate or
 * debt in it): their rates must keep updating and stay editable, or totals use a stale rate forever.
 */
export function useCurrenciesInUse(): CurrencyMeta[] {
  const { data } = useCurrencies()
  const { data: subs } = useSubAccounts()
  const { data: holdings } = useHoldings()
  const { data: certs } = useCertificates()
  const { data: debts } = useDebts()
  return useMemo(() => {
    const used = new Set<string>([...(subs ?? []), ...(holdings ?? []), ...(certs ?? []), ...(debts ?? [])].map((r) => r.currency))
    const list = (data ?? []).filter((c) => c.is_active || used.has(c.code)).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals }))
    return [...list.filter((c) => c.code === DEFAULT_CURRENCY), ...list.filter((c) => c.code !== DEFAULT_CURRENCY)]
  }, [data, subs, holdings, certs, debts])
}

export function useActiveCurrencies(): CurrencyMeta[] {
  const { data } = useCurrencies()
  // EGP always first in every currency picker
  return useMemo(() => {
    const list = (data ?? []).filter((c) => c.is_active).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals }))
    return [...list.filter((c) => c.code === DEFAULT_CURRENCY), ...list.filter((c) => c.code !== DEFAULT_CURRENCY)]
  }, [data])
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

/**
 * Conversion at the rate that applied on a given date. Use for anything historical
 * (transactions, reports, snapshots); use useConvert for current values (balances, net worth now).
 */
export function useHistoricalConvert() {
  const display = useDisplayCurrency()
  const { data } = useRates()
  return useMemo(() => {
    const tableAt = rateResolver(data ?? [])
    return {
      display,
      tableAt,
      toDisplayAt: (amount: NumericInput, from: string, date: string): Decimal => convert(amount, from, display, tableAt(date)) ?? d(0),
      betweenAt: (amount: NumericInput, from: string, to: string, date: string): Decimal | null => convert(amount, from, to, tableAt(date)),
    }
  }, [data, display])
}

export function useMoneyFormatter() {
  const { data: all } = useCurrencies()
  const metas = useMemo(() => (all ?? []).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals })), [all])
  return useMemo(
    () => (value: NumericInput, currency: string, opts: FormatMoneyOptions = {}) => formatMoney(value, currency, { currencies: metas, ...opts }),
    [metas],
  )
}
