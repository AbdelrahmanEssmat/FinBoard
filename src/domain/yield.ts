/**
 * Yield-bearing savings balances ("Clouds"): an annual rate paid daily or monthly.
 * Rates are quoted as annual percentages (e.g. 17.31 for 17.31% a year).
 */
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { d, Decimal, roundMoney, type NumericInput } from '@/domain/money'

export type YieldFrequency = 'daily' | 'monthly'

export const YIELD_LABELS: Record<YieldFrequency, string> = { daily: 'Paid daily', monthly: 'Paid monthly' }

/** Interest for one period on the given balance. */
export function yieldPerPeriod(balance: NumericInput, annualRate: NumericInput, frequency: YieldFrequency): Decimal {
  const r = d(annualRate).div(100)
  return roundMoney(d(balance).times(r).div(frequency === 'daily' ? 365 : 12), 4)
}

/** Expected interest over a 30-day month at the current balance (simple, no compounding). */
export function projectedMonthlyYield(balance: NumericInput, annualRate: NumericInput, frequency: YieldFrequency): Decimal {
  const per = yieldPerPeriod(balance, annualRate, frequency)
  return frequency === 'daily' ? per.times(30) : per
}

/** Effective annual yield with compounding at the payout frequency. */
export function effectiveAnnualRate(annualRate: NumericInput, frequency: YieldFrequency): Decimal {
  const r = d(annualRate).div(100)
  const n = frequency === 'daily' ? 365 : 12
  const eff = Math.pow(1 + r.div(n).toNumber(), n) - 1
  return d(eff * 100)
}

/** Next date interest will be credited, given when the yield started and today. */
export function nextYieldDate(since: string | null, frequency: YieldFrequency, today: string): string {
  if (frequency === 'daily') return format(addDays(parseISO(today), 1), 'yyyy-MM-dd')
  const start = parseISO(since ?? today)
  for (let n = 1; n < 1200; n++) {
    const next = addMonths(start, n)
    const iso = format(next, 'yyyy-MM-dd')
    if (iso > today) return iso
  }
  return today
}

export function daysUntilNextYield(since: string | null, frequency: YieldFrequency, today: string): number {
  return differenceInCalendarDays(parseISO(nextYieldDate(since, frequency, today)), parseISO(today))
}
