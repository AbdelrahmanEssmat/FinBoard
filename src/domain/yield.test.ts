import { describe, expect, it } from 'vitest'
import { effectiveAnnualRate, nextYieldDate, projectedMonthlyYield, yieldPerPeriod } from '@/domain/yield'

describe('yield (clouds)', () => {
  it('daily and monthly period interest', () => {
    expect(yieldPerPeriod('100000', '17.31', 'daily').toFixed(2)).toBe('47.42')
    expect(yieldPerPeriod('100000', '20.29', 'monthly').toFixed(2)).toBe('1690.83')
  })
  it('projected monthly income', () => {
    expect(projectedMonthlyYield('100000', '17.31', 'daily').toFixed(2)).toBe('1422.74')
    expect(projectedMonthlyYield('100000', '20.29', 'monthly').toFixed(2)).toBe('1690.83')
  })
  it('effective annual rate compounds', () => {
    expect(effectiveAnnualRate('17.31', 'daily').toFixed(2)).toBe('18.89')
    expect(effectiveAnnualRate('20.29', 'monthly').toFixed(2)).toBe('22.29')
  })
  it('next payout date', () => {
    expect(nextYieldDate(null, 'daily', '2026-09-26')).toBe('2026-09-27')
    expect(nextYieldDate('2026-08-10', 'monthly', '2026-09-26')).toBe('2026-10-10')
    expect(nextYieldDate('2026-01-31', 'monthly', '2026-02-15')).toBe('2026-02-28')
  })
})
