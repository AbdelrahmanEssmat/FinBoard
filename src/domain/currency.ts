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

/**
 * Rates that applied on `date`. A currency with no rate on or before that date (rates only
 * started being recorded later) falls back to its earliest known rate, rather than being
 * treated as missing, which would make old amounts count as zero.
 */
export function buildRateTableAt(rows: RateRow[], date: string): RateTable {
  const table = buildRateTable(rows, date)
  const earliest = new Map<string, RateRow>()
  for (const row of rows) {
    if (row.quote in table) continue
    const cur = earliest.get(row.quote)
    if (!cur || row.rate_date < cur.rate_date || (row.rate_date === cur.rate_date && isBetter(row, cur))) earliest.set(row.quote, row)
  }
  for (const [code, row] of earliest) table[code] = row.rate
  return table
}

/** Memoised date → rate table lookup for converting many dated amounts. */
export function rateResolver(rows: RateRow[]): (date: string) => RateTable {
  const cache = new Map<string, RateTable>()
  return (date) => {
    let t = cache.get(date)
    if (!t) {
      t = buildRateTableAt(rows, date)
      cache.set(date, t)
    }
    return t
  }
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

/** The currency every new form, picker and total starts in. */
export const DEFAULT_CURRENCY = 'EGP'

/** EGP items first, then the rest in their saved order (for picking a default balance). */
export function defaultFirst<T extends { currency: string }>(items: T[]): T[] {
  return [...items.filter((i) => i.currency === DEFAULT_CURRENCY), ...items.filter((i) => i.currency !== DEFAULT_CURRENCY)]
}
