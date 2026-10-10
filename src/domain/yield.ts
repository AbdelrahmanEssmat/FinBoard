/**
 * Yield-bearing savings balances ("Clouds"), calculated the way Thndr does. The rate on a Cloud
 * (17.30%, 20.26%) is the yearly return with the gains kept in. Behind it is a lower simple rate
 * (16.06%, 18.59%): every day earns balance × simple / 365, and the gains compound once a month.
 * An Instant (daily) Cloud posts each day's gain that day; a Monthly Cloud posts the month's gains
 * on its payout day. Mirrors public.accrue_yield (migration 0019).
 */
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { d, Decimal, roundMoney, type NumericInput } from '@/domain/money'

export type YieldFrequency = 'daily' | 'monthly'

export const YIELD_LABELS: Record<YieldFrequency, string> = { daily: 'Paid daily', monthly: 'Paid monthly' }

/** The simple yearly rate behind a shown rate: what you'd get taking the gains out every month. */
export function simpleAnnualRate(shownRate: NumericInput): Decimal {
  const r = d(shownRate).div(100).toNumber()
  if (r <= -1) return d(0)
  return d(12 * (Math.pow(1 + r, 1 / 12) - 1) * 100)
}

/** What one day earns on this balance. */
export function yieldPerDay(balance: NumericInput, shownRate: NumericInput): Decimal {
  return roundMoney(d(balance).times(simpleAnnualRate(shownRate)).div(100).div(365), 4)
}

/** Interest for one posting: a day for a daily Cloud, the period's days for a monthly one. */
export function yieldPerPeriod(balance: NumericInput, shownRate: NumericInput, frequency: YieldFrequency, periodDays = 30): Decimal {
  const day = yieldPerDay(balance, shownRate)
  return frequency === 'daily' ? day : roundMoney(day.times(periodDays), 4)
}

/** Expected interest in an average month (365/12 days) at the current balance. */
export function projectedMonthlyYield(balance: NumericInput, shownRate: NumericInput): Decimal {
  return roundMoney(d(balance).times(simpleAnnualRate(shownRate)).div(100).div(12), 4)
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

/** How many days the next monthly payout covers (from the previous payout day to the next). */
export function nextPeriodDays(since: string | null, today: string): number {
  const next = nextYieldDate(since, 'monthly', today)
  const prev = format(addMonths(parseISO(next), -1), 'yyyy-MM-dd')
  return Math.max(1, differenceInCalendarDays(parseISO(next), parseISO(prev)))
}
