import Decimal from 'decimal.js'

// Half away from zero, the same as Postgres round(numeric), so app and database always agree to the cent.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })

/** Anything the database or a form can hand us. */
export type NumericInput = Decimal | number | string | null | undefined

/** Build a Decimal safely. Null/undefined/empty/invalid become 0. */
export function d(value: NumericInput): Decimal {
  if (value instanceof Decimal) return value
  if (value === null || value === undefined || value === '') return new Decimal(0)
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(value) : new Decimal(0)
  const cleaned = value.replace(/[,\s_]/g, '')
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
