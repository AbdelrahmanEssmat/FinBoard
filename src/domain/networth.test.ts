import { describe, expect, it } from 'vitest'
import { computeNetWorth } from '@/domain/networth'
import { goldSummary, pricesFromSpot } from '@/domain/gold'

const rates = { USD: 1, EGP: '50' }

describe('net worth', () => {
  it('adds every asset class, converts to base and subtracts what I owe', () => {
    const r = computeNetWorth({
      base: 'EGP',
      rates,
      subAccounts: [
        { id: 'a', currency: 'EGP', balance: '10000', is_archived: false },
        { id: 'b', currency: 'USD', balance: '100', is_archived: false }, // 5000 EGP
        { id: 'c', currency: 'EGP', balance: '999', is_archived: true }, // ignored
        { id: 'd', currency: 'EGP', balance: '500', is_archived: false, account: { is_archived: false, type: 'investment' } }, // uninvested Thndr cash → accounts
        { id: 'e', currency: 'EGP', balance: '1000', is_archived: false, yield_rate: '17.31', account: { is_archived: false, type: 'investment' } }, // a Cloud → clouds
      ],
      certificates: [{ principal: '20000', currency: 'EGP', is_closed: false }, { principal: '1', currency: 'EGP', is_closed: true }],
      holdings: [{ units: '10', current_price: '150', currency: 'EGP' }], // 1500
      gold: [{ karat: 21, weight_grams: '10', purchase_price: '50000' }], // 10 × 6000 = 60000
      goldPrices: { perGram: { 21: '6000' }, source: 'local' },
      debts: [
        { id: 'd1', direction: 'owed_to_me', amount: '3000', currency: 'EGP', status: 'open' },
        { id: 'd2', direction: 'i_owe', amount: '100', currency: 'USD', status: 'open' }, // 5000
        { id: 'd3', direction: 'i_owe', amount: '999', currency: 'EGP', status: 'settled' },
      ],
      paymentsByDebt: { d1: [{ amount: '1000', date: '2026-01-01' }] }, // remaining 2000
    })
    expect(r.byClass.accounts.toString()).toBe('15500')
    expect(r.byClass.certificates.toString()).toBe('20000')
    expect(r.byClass.clouds.toString()).toBe('1000')
    expect(r.byClass.investments.toString()).toBe('1500') // holdings only
    expect(r.byClass.gold.toString()).toBe('60000')
    expect(r.byClass.receivables.toString()).toBe('2000')
    expect(r.byClass.liabilities.toString()).toBe('5000')
    expect(r.total.toString()).toBe('95000')
    expect(r.byCurrency.EGP!.toString()).toBe('93000')
    expect(r.byCurrency.USD!.toString()).toBe('5000')
  })
  it('with every holding deleted, investments is zero even if a platform still holds cash or a Cloud', () => {
    const r = computeNetWorth({
      base: 'EGP', rates,
      subAccounts: [
        { id: 'cash', currency: 'EGP', balance: '0', is_archived: false, account: { is_archived: false, type: 'investment' } },
        { id: 'cloud', currency: 'EGP', balance: '105299.13', is_archived: false, yield_rate: '17.31', account: { is_archived: false, type: 'investment' } },
      ],
      certificates: [], holdings: [], gold: [], goldPrices: { perGram: {}, source: 'none' }, debts: [], paymentsByDebt: {},
    })
    expect(r.byClass.investments.toString()).toBe('0')
    expect(r.byClass.clouds.toString()).toBe('105299.13')
    expect(r.total.toString()).toBe('105299.13')
  })
  it('credit card debt is its own class, subtracted from the total and kept out of accounts (same as the SQL test)', () => {
    const card = { is_archived: false, type: 'credit_card' }
    const r = computeNetWorth({
      base: 'EGP', rates,
      subAccounts: [
        { id: 'cash', currency: 'EGP', balance: '50000', is_archived: false, account: { is_archived: false, type: 'cash' } },
        { id: 'visa', currency: 'EGP', balance: '-8000', is_archived: false, account: card },
        { id: 'visa-usd', currency: 'USD', balance: '-10', is_archived: false, account: card }, // 500
      ],
      certificates: [], holdings: [], gold: [], goldPrices: { perGram: {}, source: 'none' }, debts: [], paymentsByDebt: {},
    })
    expect(r.byClass.cards.toString()).toBe('8500')
    expect(r.byClass.accounts.toString()).toBe('50000')
    expect(r.total.toString()).toBe('41500')
    expect(r.byCurrency.EGP!.toString()).toBe('50000')
    expect(r.byCurrency.USD).toBeUndefined()
    // paying 5,000 from cash to the card leaves net worth unchanged
    const after = computeNetWorth({
      base: 'EGP', rates,
      subAccounts: [
        { id: 'cash', currency: 'EGP', balance: '45000', is_archived: false, account: { is_archived: false, type: 'cash' } },
        { id: 'visa', currency: 'EGP', balance: '-3000', is_archived: false, account: card },
        { id: 'visa-usd', currency: 'USD', balance: '-10', is_archived: false, account: card },
      ],
      certificates: [], holdings: [], gold: [], goldPrices: { perGram: {}, source: 'none' }, debts: [], paymentsByDebt: {},
    })
    expect(after.total.toString()).toBe('41500')
  })
  it('switching base currency scales everything', () => {
    const r = computeNetWorth({
      base: 'USD', rates,
      subAccounts: [{ id: 'a', currency: 'EGP', balance: '5000', is_archived: false }],
      certificates: [], holdings: [], gold: [], goldPrices: { perGram: {}, source: 'none' }, debts: [], paymentsByDebt: {},
    })
    expect(r.total.toString()).toBe('100')
  })
})

describe('gold', () => {
  it('derives karat prices from spot', () => {
    const p = pricesFromSpot('2400', '50') // 2400 USD/oz
    expect(p[24].toFixed(2)).toBe('3858.09')
    expect(p[21].toFixed(2)).toBe('3375.83')
  })
  it('summary includes workmanship in cost but not in value', () => {
    const s = goldSummary(
      [{ karat: 18, weight_grams: '5', purchase_price: '20000', workmanship_cost: '1000' }],
      { perGram: { 18: '5000' }, source: 'local' },
    )
    expect(s.value.toString()).toBe('25000')
    expect(s.cost.toString()).toBe('21000')
    expect(s.gain.toString()).toBe('4000')
    expect(s.missingPrice).toBe(false)
  })
  it('summary converts purchase costs in other currencies', () => {
    const s = goldSummary(
      [{ karat: 21, weight_grams: '10', purchase_price: '1000', purchase_currency: 'USD' }],
      { perGram: { 21: '5000' }, source: 'local' },
      (a, cur) => (cur === 'USD' ? a.times(50) : a),
    )
    expect(s.cost.toString()).toBe('50000')
    expect(s.gain.toString()).toBe('0')
  })
})