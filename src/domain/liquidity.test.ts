import { describe, expect, it } from 'vitest'
import { computeLiquidity } from '@/domain/liquidity'

const rates = { USD: '1', EGP: '50' } // 1 USD = 50 EGP
const acc = (id: string, type: string, extra = {}) => ({ id, name: id.toUpperCase(), type, color: '#000', icon: 'x', is_archived: false, ...extra })
const sub = (id: string, account_id: string, currency: string, balance: string, extra = {}) => ({ id, account_id, currency, balance, is_archived: false, name: null, yield_rate: null, ...extra })

const accounts = [acc('cib', 'bank'), acc('nbe', 'bank'), acc('cash', 'cash'), acc('vodafone', 'wallet'), acc('thndr', 'investment'), acc('misc', 'other'), acc('old', 'bank', { is_archived: true })]
const subs = [
  sub('cib-egp', 'cib', 'EGP', '100000'),
  sub('cib-usd', 'cib', 'USD', '1000'), // 50,000 EGP
  sub('cib-cloud', 'cib', 'EGP', '80000', { yield_rate: '17.31' }), // a Cloud inside a bank: not spendable
  sub('nbe-egp', 'nbe', 'EGP', '20000'),
  sub('cash-egp', 'cash', 'EGP', '5000'),
  sub('cash-usd', 'cash', 'USD', '100'), // 5,000 EGP
  sub('wallet-egp', 'vodafone', 'EGP', '2000'),
  sub('thndr-egp', 'thndr', 'EGP', '30000'),
  sub('misc-egp', 'misc', 'EGP', '7000'),
  sub('old-egp', 'old', 'EGP', '999999'),
  sub('arch-egp', 'nbe', 'EGP', '5555', { is_archived: true }),
]

describe('liquidity', () => {
  const l = computeLiquidity(accounts, subs, 'EGP', rates)

  it('counts only spendable bank, cash and wallet balances', () => {
    // 100,000 + 50,000 + 20,000 + 5,000 + 5,000 + 2,000
    expect(l.total.toNumber()).toBe(182000)
  })

  it('keeps each currency in its own amount, and its share', () => {
    expect(l.byCurrency.map((c) => [c.currency, c.amount.toNumber(), c.base.toNumber()])).toEqual([
      ['EGP', 127000, 127000],
      ['USD', 1100, 55000],
    ])
    expect(Math.round(l.byCurrency.reduce((a, c) => a + c.pct, 0))).toBe(100)
  })

  it('shows where it is: per account (largest first) and per type', () => {
    expect(l.byAccount.map((a) => [a.id, a.base.toNumber()])).toEqual([
      ['cib', 150000],
      ['nbe', 20000],
      ['cash', 10000],
      ['vodafone', 2000],
    ])
    expect(l.byAccount[0]!.balances.map((b) => b.currency)).toEqual(['EGP', 'USD'])
    expect(l.byType.bank.toNumber()).toBe(170000)
    expect(l.byType.cash.toNumber()).toBe(10000)
    expect(l.byType.wallet.toNumber()).toBe(2000)
  })

  it('says what was left out', () => {
    expect(l.excluded.clouds.toNumber()).toBe(80000)
    expect(l.excluded.platforms.toNumber()).toBe(30000)
    expect(l.excluded.other.toNumber()).toBe(7000)
  })

  it('totals in USD when that is the display currency', () => {
    expect(computeLiquidity(accounts, subs, 'USD', rates).total.toNumber()).toBe(3640)
  })

  it('nothing liquid yet', () => {
    const e = computeLiquidity([acc('thndr', 'investment')], [sub('t', 'thndr', 'EGP', '10')], 'EGP', rates)
    expect(e.total.toNumber()).toBe(0)
    expect(e.byAccount).toEqual([])
  })
})
