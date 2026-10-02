import Decimal from 'decimal.js'

// Half away from zero, the same as Postgres round(numeric), so app and database always agree to the cent.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })

/** Anything the database or a form can hand us. */
export type NumericInput = Decimal | number | string | null | undefined

/**
 * Normalise what a person types: Arabic-Indic and Persian digits become 0-9 and the Arabic decimal
 * separator a dot; spaces, underscores and the Arabic thousands separator go. Commas and dots are read
 * the way people write them:
 *   12,500 · 1,234,567 · 1,234.50  → grouping commas (dot = decimals)
 *   1,5 · 12,50 · 1.234,56         → comma = decimals (the separator that comes last wins)
 *   1.234.567                      → grouping dots
 */
function cleanNumber(value: string): string {
  let s = value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[٬\s_]/g, '')
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (hasComma) {
    if (/^[-+]?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '')
    else if ((s.match(/,/g) ?? []).length === 1) s = s.replace(',', '.')
  } else if (/^[-+]?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  return s
}

/**
 * A typed amount, or null when the text is empty or not a plain number ("12a", "1.2.3").
 * Use it to validate form fields: d() quietly turns anything it can't read into 0.
 */
export function parseAmount(value: string | null | undefined): Decimal | null {
  const cleaned = cleanNumber(value ?? '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  return new Decimal(cleaned)
}

/** Build a Decimal safely. Null/undefined/empty/invalid become 0. */
export function d(value: NumericInput): Decimal {
  if (value instanceof Decimal) return value
  if (value === null || value === undefined || value === '') return new Decimal(0)
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(value) : new Decimal(0)
  const cleaned = cleanNumber(value)
  try {
    const n = new Decimal(cleaned)
    return n.isFinite() ? n : new Decimal(0)
  } catch {
    return new Decimal(0)
  }
}

export const ZERO = new Decimal(0)

export function sum(values: NumericInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), ZERO)
}

/** Round to a currency's minor unit (half away from zero, like Postgres). */
export function roundMoney(value: NumericInput, decimals = 2): Decimal {
  return d(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
}

/** String for the wire (Postgres numeric accepts strings). */
export function toDb(value: NumericInput, decimals = 4): string {
  return d(value).toFixed(decimals)
}

export function isZero(value: NumericInput): boolean {
  return d(value).isZero()
}

export function percentChange(from: NumericInput, to: NumericInput): Decimal | null {
  const f = d(from)
  if (f.isZero()) return null
  return d(to).minus(f).div(f).times(100)
}

export { Decimal }
