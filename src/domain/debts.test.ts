import { describe, expect, it } from 'vitest'
import { d, type NumericInput } from '@/domain/money'
import { debtActivity, nextMonthlyDate } from '@/domain/debts'

const toBase = (amount: NumericInput, currency: string) => (currency === 'USD' ? d(amount).times(50) : d(amount))
const oct = { from: '2026-10-01', to: '2026-10-31' }

describe('debt activity', () => {
  const debts = [
    // lent from the bank this month: the balance went down by what is now owed, net worth unchanged
    { id: 'lent', direction: 'owed_to_me' as const, amount: '10000', currency: 'EGP', date: '2026-10-02', transaction_id: 'tx1' },
    // someone owes you 500 for their share of a dinner you paid: nothing left an account for it
    { id: 'share', direction: 'owed_to_me' as const, amount: '500', currency: 'EGP', date: '2026-10-05', transaction_id: null },
    // borrowed 100 USD in cash, not tracked in any account
    { id: 'borrowed', direction: 'i_owe' as const, amount: '100', currency: 'USD', date: '2026-10-07', transaction_id: null },
    // an old loan from August
    { id: 'old', direction: 'i_owe' as const, amount: '3000', currency: 'EGP', date: '2026-08-15', transaction_id: 'tx2' },
  ]
  const payments = [
    { debt_id: 'lent', amount: '4000', date: '2026-10-20', transaction_id: 'tx3' }, // back into the bank
    { debt_id: 'share', amount: '500', date: '2026-10-21', transaction_id: null }, // paid in cash you don't track
    { debt_id: 'old', amount: '1000', date: '2026-10-25', transaction_id: 'tx4' }, // paid back from the bank
    { debt_id: 'old', amount: '1000', date: '2026-09-25', transaction_id: 'tx5' }, // last month: not counted
  ]

  it('adds up what was lent, borrowed and repaid in the period, at each day’s rate', () => {
    const a = debtActivity(debts, payments, oct, toBase)
    expect(a.lent.toString()).toBe('10500')
    expect(a.borrowed.toString()).toBe('5000')
    expect(a.receivedBack.toString()).toBe('4500')
    expect(a.paidBack.toString()).toBe('1000')
    expect(a.any).toBe(true)
  })

  it('changes the accounts (and net worth) only where money moved: open debts are just records', () => {
    const a = debtActivity(debts, payments, oct, toBase)
    // -10,000 lent out of the bank, +4,000 of it repaid into the bank, -1,000 paid back on the old loan;
    // the dinner share, the cash borrowing and the cash repayment moved nothing in any account
    expect(a.balanceEffect.toString()).toBe('-7000')
  })

  it('is empty for a period with nothing in it', () => {
    const a = debtActivity(debts, payments, { from: '2026-11-01', to: '2026-11-30' }, toBase)
    expect(a.any).toBe(false)
    expect(a.balanceEffect.isZero()).toBe(true)
  })

  it('ignores repayments of a debt it doesn’t know', () => {
    const a = debtActivity([], [{ debt_id: 'gone', amount: '50', date: '2026-10-03', transaction_id: null }], oct, toBase)
    expect(a.any).toBe(false)
  })
})

describe('monthly debt dates', () => {
  it('fall on the first date’s day of the month, counted from the first date', () => {
    expect(nextMonthlyDate('2026-01-05', '2026-10-04')).toBe('2026-10-05')
    expect(nextMonthlyDate('2026-01-05', '2026-10-05')).toBe('2026-10-05')
    expect(nextMonthlyDate('2026-01-05', '2026-10-06')).toBe('2026-11-05')
    // end of month: February takes its last day, March is back on the 31st (like the database)
    expect(nextMonthlyDate('2026-01-31', '2026-02-01')).toBe('2026-02-28')
    expect(nextMonthlyDate('2026-01-31', '2026-03-01')).toBe('2026-03-31')
    expect(nextMonthlyDate('2026-12-20', '2026-10-01')).toBe('2026-12-20')
  })
})
