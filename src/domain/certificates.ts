import { addMonths, addYears, differenceInCalendarDays, isAfter, isBefore, parseISO, format } from 'date-fns'
import { d, Decimal, roundMoney, type NumericInput } from '@/domain/money'

export type PayoutFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'at_maturity'

export interface CertificateInput {
  principal: NumericInput
  interest_rate: NumericInput // annual percent, e.g. 27 for 27%
  payout_frequency: PayoutFrequency
  start_date: string // YYYY-MM-DD
  maturity_date: string
}

export const PAYOUT_LABELS: Record<PayoutFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semi_annual: 'Every 6 months',
  annual: 'Yearly',
  at_maturity: 'At maturity',
}

const PERIODS_PER_YEAR: Record<Exclude<PayoutFrequency, 'at_maturity'>, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
}

function iso(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Interest paid on each payout date. Matches the SQL function certificate_payout_amount. */
export function payoutAmount(c: CertificateInput): Decimal {
  const p = d(c.principal)
  const r = d(c.interest_rate).div(100)
  if (c.payout_frequency === 'at_maturity') {
    const days = differenceInCalendarDays(parseISO(c.maturity_date), parseISO(c.start_date))
    return roundMoney(p.times(r).times(days).div(365), 4)
  }
  return roundMoney(p.times(r).div(PERIODS_PER_YEAR[c.payout_frequency]), 4)
}

/** All payout dates from start (exclusive) to maturity (inclusive). */
export function payoutSchedule(c: CertificateInput): string[] {
  const start = parseISO(c.start_date)
  const maturity = parseISO(c.maturity_date)
  if (!isAfter(maturity, start)) return []
  if (c.payout_frequency === 'at_maturity') return [c.maturity_date]
  const months = 12 / PERIODS_PER_YEAR[c.payout_frequency]
  const dates: string[] = []
  for (let n = 1; n < 10_000; n++) {
    const next = months === 12 ? addYears(start, n) : addMonths(start, months * n)
    if (isAfter(next, maturity)) break
    dates.push(iso(next))
  }
  return dates
}

export function nextPayoutDate(c: CertificateInput, today: string): string | null {
  return payoutSchedule(c).find((dt) => dt >= today) ?? null
}

export function daysUntil(dateIso: string, today: string): number {
  return differenceInCalendarDays(parseISO(dateIso), parseISO(today))
}

/** Total interest expected over the certificate's whole life. */
export function totalExpectedInterest(c: CertificateInput): Decimal {
  return payoutAmount(c).times(payoutSchedule(c).length)
}

/** Interest earned so far: paid-out periods plus pro-rata accrual of the current period. */
export function interestEarnedSoFar(c: CertificateInput, today: string): { paid: Decimal; accrued: Decimal; total: Decimal } {
  const t = parseISO(today)
  const start = parseISO(c.start_date)
  const maturity = parseISO(c.maturity_date)
  const amount = payoutAmount(c)
  const zero = new Decimal(0)
  if (!isAfter(t, start)) return { paid: zero, accrued: zero, total: zero }
  const schedule = payoutSchedule(c)
  const paidDates = schedule.filter((dt) => dt <= today)
  const paid = amount.times(paidDates.length)
  // accrual inside the current period
  const periodStart = paidDates.length ? parseISO(paidDates[paidDates.length - 1]!) : start
  const periodEnd = schedule[paidDates.length] ? parseISO(schedule[paidDates.length]!) : maturity
  let accrued = zero
  if (isBefore(t, maturity) && isAfter(periodEnd, periodStart)) {
    const periodDays = differenceInCalendarDays(periodEnd, periodStart)
    const elapsed = Math.min(periodDays, differenceInCalendarDays(t, periodStart))
    accrued = amount.times(elapsed).div(periodDays)
  }
  return { paid, accrued: roundMoney(accrued, 4), total: roundMoney(paid.plus(accrued), 4) }
}

export function isMatured(c: CertificateInput, today: string): boolean {
  return c.maturity_date <= today
}
