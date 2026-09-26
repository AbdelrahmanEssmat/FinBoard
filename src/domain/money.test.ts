import { describe, expect, it } from 'vitest'
import { d, roundMoney, sum, toDb, percentChange } from '@/domain/money'
import { formatMoney, formatNumber, formatDate } from '@/domain/format'

describe('money', () => {
  it('parses strings, numbers and nulls without floating point drift', () => {
    expect(d('0.1').plus(d('0.2')).toString()).toBe('0.3')
    expect(d(null).toString()).toBe('0')
    expect(d('').toString()).toBe('0')
    expect(d('1,234.50').toString()).toBe('1234.5')
    expect(d('abc').toString()).toBe('0')
    expect(d(12.34).toString()).toBe('12.34')
  })
  it('sums and rounds half-even', () => {
    expect(sum(['1.005', '2.005']).toString()).toBe('3.01')
    expect(roundMoney('2.345').toString()).toBe('2.34')
    expect(roundMoney('2.355').toString()).toBe('2.36')
    expect(toDb('10')).toBe('10.0000')
  })
  it('percent change', () => {
    expect(percentChange(100, 125)!.toString()).toBe('25')
    expect(percentChange(0, 125)).toBeNull()
  })
})

describe('format', () => {
  it('thousand separators and symbols', () => {
    expect(formatNumber('1234567.891', 2)).toBe('1,234,567.89')
    expect(formatNumber('-1234.5', 2)).toBe('-1,234.50')
    expect(formatMoney('12345', 'EGP')).toBe('E£ 12,345.00')
    expect(formatMoney('-50', 'USD')).toBe('-$ 50.00')
    expect(formatMoney('50', 'USD', { showSign: true })).toBe('+$ 50.00')
    expect(formatMoney('1500000', 'EGP', { compact: true })).toBe('E£ 1.5M')
    expect(formatMoney('99', 'EGP', { symbolStyle: 'code' })).toBe('99.00 EGP')
  })
  it('dates in DD/MM/YYYY', () => {
    expect(formatDate('2026-09-26')).toBe('26/09/2026')
    expect(formatDate(null)).toBe('')
  })
})
