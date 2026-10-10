import { describe, expect, it } from 'vitest'
import { nextPeriodDays, nextYieldDate, projectedMonthlyYield, simpleAnnualRate, yieldPerDay, yieldPerPeriod } from '@/domain/yield'

describe('yield (clouds), like the Thndr calculator', () => {
  it('the shown rate hides a lower simple rate', () => {
    expect(simpleAnnualRate('17.30').toFixed(3)).toBe('16.063')
    expect(simpleAnnualRate('20.26').toFixed(3)).toBe('18.591')
    expect(simpleAnnualRate('0').toFixed(3)).toBe('0.000')
  })
  it('a day on 250,000: 110.02 at 17.30%, 127.34 at 20.26%', () => {
    expect(yieldPerDay('250000', '17.30').toFixed(2)).toBe('110.02')
    expect(yieldPerDay('250000', '20.26').toFixed(2)).toBe('127.34')
  })
  it('a posting: one day for an Instant Cloud, the period for a Monthly one (31 days → 3,948)', () => {
    expect(yieldPerPeriod('250000', '17.30', 'daily').toFixed(2)).toBe('110.02')
    // Thndr shows 3,948 and 3,880: the same to the pound once rounding is allowed for
    expect(yieldPerPeriod('250000', '20.26', 'monthly', 31).toNumber()).toBeCloseTo(3948, -1)
    expect(yieldPerPeriod('250000', '20.26', 'monthly', 30).toNumber()).toBeCloseTo(3820, -1)
  })
  it('projected month: the simple rate over 12', () => {
    expect(projectedMonthlyYield('250000', '17.30').toFixed(0)).toBe('3346')
    expect(projectedMonthlyYield('250000', '20.26').toFixed(0)).toBe('3873')
  })
  it('next payout date', () => {
    expect(nextYieldDate(null, 'daily', '2026-09-26')).toBe('2026-09-27')
    expect(nextYieldDate('2026-08-10', 'monthly', '2026-09-26')).toBe('2026-10-10')
    expect(nextYieldDate('2026-01-31', 'monthly', '2026-02-15')).toBe('2026-02-28')
  })
  it('days the next monthly payout covers', () => {
    expect(nextPeriodDays('2026-08-01', '2026-10-11')).toBe(31) // 1 Oct → 1 Nov
    expect(nextPeriodDays('2026-08-01', '2026-11-11')).toBe(30) // 1 Nov → 1 Dec
  })
})
