import { describe, expect, it } from 'vitest'
import { buildRateTable, buildRateTableAt, convert, crossRate, rateResolver } from '@/domain/currency'

const rates = { USD: 1, EGP: '50', EUR: '0.9', SAR: '3.75' }

describe('currency conversion', () => {
  it('converts via USD in both directions', () => {
    expect(convert('100', 'USD', 'EGP', rates)!.toString()).toBe('5000')
    expect(convert('5000', 'EGP', 'USD', rates)!.toString()).toBe('100')
    expect(convert('90', 'EUR', 'USD', rates)!.toString()).toBe('100')
  })
  it('cross rates between two non-USD currencies', () => {
    // 1 EUR = 1/0.9 USD = 55.555.. EGP
    expect(crossRate('EUR', 'EGP', rates)!.toFixed(4)).toBe('55.5556')
    expect(convert('375', 'SAR', 'EGP', rates)!.toString()).toBe('5000')
  })
  it('same currency is identity, missing rate is null', () => {
    expect(convert('42', 'EGP', 'EGP', rates)!.toString()).toBe('42')
    expect(convert('42', 'GBP', 'EGP', rates)).toBeNull()
  })
  it('buildRateTable picks latest rate on/before date, manual wins ties', () => {
    const rows = [
      { quote: 'EGP', rate: '48', rate_date: '2026-09-01', user_id: null },
      { quote: 'EGP', rate: '50', rate_date: '2026-09-10', user_id: null },
      { quote: 'EGP', rate: '52', rate_date: '2026-09-10', user_id: 'me' },
      { quote: 'EGP', rate: '55', rate_date: '2026-09-20', user_id: null },
    ]
    expect(buildRateTable(rows, '2026-09-05').EGP).toBe('48')
    expect(buildRateTable(rows, '2026-09-10').EGP).toBe('52')
    expect(buildRateTable(rows, '2026-09-15').EGP).toBe('52')
    expect(buildRateTable(rows).EGP).toBe('55')
    expect(buildRateTable(rows).USD).toBe(1)
  })
  it('historical tables use the rate of that day, falling back to the earliest known rate', () => {
    const rows = [
      { quote: 'EGP', rate: '48', rate_date: '2026-09-01', user_id: null },
      { quote: 'EGP', rate: '50', rate_date: '2026-09-10', user_id: null },
    ]
    expect(buildRateTableAt(rows, '2026-09-05').EGP).toBe('48')
    expect(buildRateTableAt(rows, '2026-09-20').EGP).toBe('50')
    // before any rate was recorded: earliest known, not missing
    expect(buildRateTableAt(rows, '2026-01-01').EGP).toBe('48')
    const at = rateResolver(rows)
    expect(convert('10', 'USD', 'EGP', at('2026-09-05'))!.toString()).toBe('480')
    expect(at('2026-09-05')).toBe(at('2026-09-05')) // memoised
  })
})