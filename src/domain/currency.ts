import { d, Decimal, type NumericInput } from '@/domain/money'

/**
 * Rates are always expressed against USD: 1 USD = rate QUOTE.
 * A RateTable holds the effective rate per currency for a given moment.
 */
export type RateTable = Record<string, NumericInput>

export interface RateRow {
  quote: string
  rate: NumericInput
  rate_date: string // YYYY-MM-DD
  user_id: string | null
  fetched_at?: string
}

/** Pick the effective rate per currency on/before `date`. Manual (user) rows win ties. */
export function buildRateTable(rows: RateRow[], date?: string): RateTable {
  const table: RateTable = { USD: 1 }
  const best = new Map<string, RateRow>()
  for (const row of rows) {
    if (date && row.rate_date > date) continue
    const cur = best.get(row.quote)
    if (!cur || isBetter(row, cur)) best.set(row.quote, row)
  }
  for (const [code, row] of best) table[code] = row.rate
  return table
}

function isBetter(a: RateRow, b: RateRow): boolean {
  if (a.rate_date !== b.rate_date) return a.rate_date > b.rate_date
  const aManual = a.user_id !== null
  const bManual = b.user_id !== null
  if (aManual !== bManual) return aManual
  return (a.fetched_at ?? '') > (b.fetched_at ?? '')
}

export function usdRate(rates: RateTable, currency: string): Decimal | null {
  if (currency === 'USD') return new Decimal(1)
  const r = rates[currency]
  if (r === undefined || r === null) return null
  const dec = d(r)
  return dec.isZero() ? null : dec
}

/** Convert between any two currencies via USD. Returns null when a rate is missing. */
export function convert(amount: NumericInput, from: string, to: string, rates: RateTable): Decimal | null {
  if (from === to) return d(amount)
  const rf = usdRate(rates, from)
  const rt = usdRate(rates, to)
  if (!rf || !rt) return null
  return d(amount).div(rf).times(rt)
}

/** Convert, falling back to zero (for totals where a missing rate should not crash the UI). */
export function convertOrZero(amount: NumericInput, from: string, to: string, rates: RateTable): Decimal {
  return convert(amount, from, to, rates) ?? new Decimal(0)
}

/** Cross rate: 1 `from` = ? `to`. */
export function crossRate(from: string, to: string, rates: RateTable): Decimal | null {
  return convert(1, from, to, rates)
}
