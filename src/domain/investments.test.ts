import { describe, expect, it } from 'vitest'
import { d, type NumericInput } from '@/domain/money'
import { annualizedReturn, holdingDays, openPosition, performanceSummary, previewSale, saleReturnPct } from '@/domain/investments'

const toBaseAt = (amount: NumericInput, currency: string) => (currency === 'USD' ? d(amount).times(50) : d(amount))
const toBaseNow = (amount: NumericInput, currency: string) => (currency === 'USD' ? d(amount).times(50) : d(amount))

describe('selling a holding', () => {
  it('previews exactly what the database books (same numbers as the SQL test)', () => {
    const p = previewSale('12.5', '400', '15', '20')
    expect(p.costBasis.toString()).toBe('5000')
    expect(p.proceeds.toString()).toBe('5980')
    expect(p.realized.toString()).toBe('980')
    expect(p.realizedPct!.toFixed(1)).toBe('19.6')
    const loss = previewSale('12.5', '600', '11')
    expect(loss.realized.toString()).toBe('-900')
  })
  it('open position profit/loss', () => {
    const o = openPosition({ units: '1000', avg_cost: '12.5', current_price: '14.2' })
    expect(o.value.toString()).toBe('14200')
    expect(o.cost.toString()).toBe('12500')
    expect(o.pl.toString()).toBe('1700')
    expect(o.plPct!.toFixed(1)).toBe('13.6')
  })
})

const sale = (over: Partial<Parameters<typeof saleReturnPct>[0]>) => ({
  id: 's', holding_id: 'fund', date: '2026-09-01', units: '400', sell_price: '15', fees: '20', avg_cost: '12.5',
  cost_basis: '5000', proceeds: '5980', realized: '980', currency: 'EGP', bought_at: '2026-03-01', ...over,
})

describe('sale analytics', () => {
  it('return %, holding period and annualised return', () => {
    const s = sale({})
    expect(saleReturnPct(s)!.toFixed(1)).toBe('19.6')
    expect(holdingDays(s)).toBe(184)
    // (5980/5000)^(365/184) − 1 = 42.6%
    expect(annualizedReturn(s)!.toFixed(1)).toBe('42.6')
    expect(annualizedReturn(sale({ bought_at: '2026-08-20' }))).toBeNull() // under 30 days: not annualised
    expect(annualizedReturn(sale({ bought_at: null }))).toBeNull()
  })

  it('portfolio summary: realized at sale-date rates, unrealized now, win rate, best/worst, by type', () => {
    const categories = new Map([['stocks', { name: 'Stocks' }], ['funds', { name: 'Funds' }]])
    const holdings = [
      { id: 'fund', name: 'Azimut', category_id: 'funds', units: '0', avg_cost: '12.5', current_price: '11', currency: 'EGP' },
      { id: 'comi', name: 'COMI', category_id: 'stocks', units: '100', avg_cost: '80', current_price: '95', currency: 'EGP' },
      { id: 'aapl', name: 'Apple', category_id: 'stocks', units: '2', avg_cost: '150', current_price: '140', currency: 'USD' },
    ]
    const sales = [
      sale({ id: 'win' }), // +980
      sale({ id: 'loss', date: '2026-09-20', units: '600', sell_price: '11', fees: '0', cost_basis: '7500', proceeds: '6600', realized: '-900', bought_at: null }),
      sale({ id: 'usd', holding_id: 'aapl', currency: 'USD', cost_basis: '150', proceeds: '170', realized: '20', bought_at: '2026-06-01' }), // +1000 EGP
    ]
    const p = performanceSummary(sales, holdings, categories, toBaseAt, toBaseNow)
    expect(p.realized.toString()).toBe('1080') // 980 − 900 + 20×50
    expect(p.trades).toBe(3)
    expect(p.wins).toBe(2)
    expect(p.losses).toBe(1)
    expect(Math.round(p.winRate!)).toBe(67)
    expect(p.best!.id).toBe('usd')
    expect(p.worst!.id).toBe('loss')
    expect(p.avgHoldingDays).toBe(Math.round((184 + 92) / 2))
    // open: COMI 9500 vs 8000 (+1500), Apple 2×140×50=14000 vs 15000 (−1000)
    expect(p.openValue.toString()).toBe('23500')
    expect(p.unrealized.toString()).toBe('500')
    const funds = p.byCategory.find((c) => c.id === 'funds')!
    const stocks = p.byCategory.find((c) => c.id === 'stocks')!
    expect(funds.realized.toString()).toBe('80')
    expect(funds.unrealized.toString()).toBe('0')
    expect(stocks.realized.toString()).toBe('1000')
    expect(stocks.unrealized.toString()).toBe('500')
  })

  it('empty portfolio', () => {
    const p = performanceSummary([], [], new Map(), toBaseAt, toBaseNow)
    expect(p.winRate).toBeNull()
    expect(p.best).toBeNull()
    expect(p.realized.toString()).toBe('0')
  })
})
