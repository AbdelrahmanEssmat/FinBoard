import { describe, expect, it } from 'vitest'
import { interestEarnedSoFar, nextPayoutDate, payoutAmount, payoutSchedule, totalExpectedInterest, daysUntil } from '@/domain/certificates'

const monthly = {
  principal: '100000',
  interest_rate: '27',
  payout_frequency: 'monthly' as const,
  start_date: '2026-01-15',
  maturity_date: '2027-01-15',
}

describe('certificates', () => {
  it('monthly payout = principal × rate / 12', () => {
    expect(payoutAmount(monthly).toString()).toBe('2250')
    expect(payoutAmount({ ...monthly, payout_frequency: 'quarterly' }).toString()).toBe('6750')
    expect(payoutAmount({ ...monthly, payout_frequency: 'semi_annual' }).toString()).toBe('13500')
    expect(payoutAmount({ ...monthly, payout_frequency: 'annual' }).toString()).toBe('27000')
  })
  it('at maturity uses actual days / 365', () => {
    // 3-year certificate: 2026-01-01 → 2029-01-01 = 1096 days
    const c = { ...monthly, payout_frequency: 'at_maturity' as const, start_date: '2026-01-01', maturity_date: '2029-01-01' }
    expect(payoutAmount(c).toFixed(2)).toBe('81073.97')
    expect(payoutSchedule(c)).toEqual(['2029-01-01'])
  })
  it('monthly schedule has 12 dates ending on maturity', () => {
    const s = payoutSchedule(monthly)
    expect(s).toHaveLength(12)
    expect(s[0]).toBe('2026-02-15')
    expect(s[11]).toBe('2027-01-15')
    expect(totalExpectedInterest(monthly).toString()).toBe('27000')
  })
  it('quarterly schedule clips at maturity', () => {
    const s = payoutSchedule({ ...monthly, payout_frequency: 'quarterly', maturity_date: '2026-12-31' })
    expect(s).toEqual(['2026-04-15', '2026-07-15', '2026-10-15'])
  })
  it('next payout and days until', () => {
    expect(nextPayoutDate(monthly, '2026-09-26')).toBe('2026-10-15')
    expect(daysUntil('2026-10-15', '2026-09-26')).toBe(19)
    expect(nextPayoutDate(monthly, '2027-02-01')).toBeNull()
  })
  it('interest earned so far = paid periods + pro-rata accrual', () => {
    // 2026-09-26: 8 payouts done (Feb..Sep 15), 11 of 30 days into the Sep15→Oct15 period
    const e = interestEarnedSoFar(monthly, '2026-09-26')
    expect(e.paid.toString()).toBe('18000')
    expect(e.accrued.toFixed(2)).toBe('825.00')
    expect(e.total.toFixed(2)).toBe('18825.00')
    expect(interestEarnedSoFar(monthly, '2026-01-15').total.toString()).toBe('0')
    expect(interestEarnedSoFar(monthly, '2027-06-01').total.toString()).toBe('27000')
  })
})
