import { describe, expect, it } from 'vitest'
import { d, parseAmount, roundMoney, sum, toDb, percentChange } from '@/domain/money'
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
  it('sums and rounds half away from zero like Postgres', () => {
    expect(sum(['1.005', '2.005']).toString()).toBe('3.01')
    expect(roundMoney('2.345').toString()).toBe('2.35')
    expect(roundMoney('-2.345').toString()).toBe('-2.35')
    expect(roundMoney('2.355').toString()).toBe('2.36')
    expect(toDb('10')).toBe('10.0000')
  })
  it('reads amounts typed with Arabic digits', () => {
    expect(d('١٢٣٬٤٥٦٫٧٥').toString()).toBe('123456.75')
    expect(d('۵۰').toString()).toBe('50')
  })
  it('parseAmount accepts only real numbers', () => {
    expect(parseAmount('1,234.50')!.toString()).toBe('1234.5')
    expect(parseAmount(' -300 ')!.toString()).toBe('-300')
    expect(parseAmount('.5')!.toString()).toBe('0.5')
    expect(parseAmount('12.')!.toString()).toBe('12')
    expect(parseAmount('٣٠٠')!.toString()).toBe('300')
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('12a')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
    expect(parseAmount('-')).toBeNull()
  })
  it('reads commas and dots the way people type them', () => {
    expect(d('12,500').toString()).toBe('12500')
    expect(d('1,234,567.89').toString()).toBe('1234567.89')
    expect(d('1,5').toString()).toBe('1.5')
    expect(d('12,50').toString()).toBe('12.5')
    expect(d('-0,75').toString()).toBe('-0.75')
    expect(d('1.234,56').toString()).toBe('1234.56')
    expect(d('1.234.567').toString()).toBe('1234567')
    expect(d('1.5').toString()).toBe('1.5')
    expect(parseAmount('27,5')!.toString()).toBe('27.5')
    expect(parseAmount('1,2,3')).toBeNull()
    expect(parseAmount('1,23,456')).toBeNull()
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
