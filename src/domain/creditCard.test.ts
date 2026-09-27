import { describe, expect, it } from 'vitest'
import { d } from '@/domain/money'
import { cardStatement, cardUsage, dueDateAfter, effectOn, firstBillingDate, installmentSchedule, installmentsOnStatement, lastStatementDate, nextStatementDate, planProgress, statementLabel, unbilledInstallments, type CardTx } from '@/domain/creditCard'

describe('statement dates', () => {
  it('last statement on or before today', () => {
    expect(lastStatementDate('2026-09-27', 25)).toBe('2026-09-25')
    expect(lastStatementDate('2026-09-25', 25)).toBe('2026-09-25')
    expect(lastStatementDate('2026-09-10', 25)).toBe('2026-08-25')
    expect(lastStatementDate('2026-01-05', 25)).toBe('2025-12-25')
  })
  it('a day the month lacks falls on its last day', () => {
    expect(lastStatementDate('2026-09-30', 31)).toBe('2026-09-30')
    expect(lastStatementDate('2026-03-01', 30)).toBe('2026-02-28')
    expect(nextStatementDate('2026-09-30', 31)).toBe('2026-10-31')
    expect(nextStatementDate('2026-12-25', 25)).toBe('2027-01-25')
  })
  it('due date: later the same month, else next month', () => {
    expect(dueDateAfter('2026-09-01', 20)).toBe('2026-09-20')
    expect(dueDateAfter('2026-09-25', 15)).toBe('2026-10-15')
    expect(dueDateAfter('2026-09-25', 25)).toBe('2026-10-25')
    expect(dueDateAfter('2026-01-31', 30)).toBe('2026-02-28')
  })
})

const CARD = 'card'
const tx = (over: Partial<CardTx>): CardTx => ({ type: 'expense', date: '2026-09-26', amount: '0', sub_account_id: CARD, ...over })

describe('what a transaction does to the card', () => {
  it('spending lowers it; payments, refunds and transfers in raise it', () => {
    expect(effectOn(tx({ amount: '500' }), CARD).toNumber()).toBe(-500)
    expect(effectOn(tx({ type: 'income', amount: '200' }), CARD).toNumber()).toBe(200)
    expect(effectOn(tx({ type: 'transfer', sub_account_id: 'bank', to_sub_account_id: CARD, amount: '1000', to_amount: '1000' }), CARD).toNumber()).toBe(1000)
    expect(effectOn(tx({ type: 'transfer', sub_account_id: CARD, to_sub_account_id: 'cash', amount: '300', to_amount: '300' }), CARD).toNumber()).toBe(-300)
    expect(effectOn(tx({ amount: '999', sub_account_id: 'other' }), CARD).toNumber()).toBe(0)
  })
})

describe('the current statement', () => {
  // statement on the 25th, due on the 15th, minimum 5%. On 25 Sep the card owed 10,000.
  // Since then: 3,000 paid on the 26th, 1,200 spent on the 27th → balance now −8,200.
  const activity: CardTx[] = [
    tx({ date: '2026-09-20', amount: '4000' }), // before the statement: already in it
    tx({ type: 'transfer', sub_account_id: 'bank', to_sub_account_id: CARD, date: '2026-09-26', amount: '3000', to_amount: '3000' }),
    tx({ date: '2026-09-27', amount: '1200' }),
  ]
  const base = { balance: '-8200', subId: CARD, statementDay: 25, dueDay: 15, minPct: 5, activity }

  it('works back to the statement balance and what is left', () => {
    const s = cardStatement({ ...base, today: '2026-09-27' })
    expect(s.statementDate).toBe('2026-09-25')
    expect(s.dueDate).toBe('2026-10-15')
    expect(s.nextStatementDate).toBe('2026-10-25')
    expect(s.statementBalance.toNumber()).toBe(10000)
    expect(s.paid.toNumber()).toBe(3000)
    expect(s.newSpending.toNumber()).toBe(1200)
    expect(s.remaining.toNumber()).toBe(7000)
    expect(s.minimum.toNumber()).toBe(500)
    expect(s.minimumLeft.toNumber()).toBe(0) // 3,000 paid already covers the 500 minimum
    expect(s.status).toBe('due')
    expect(s.daysLeft).toBe(18)
    expect(statementLabel(s)).toBe('Due in 18 days')
  })

  it('minimum still owed when less than the minimum was paid', () => {
    const s = cardStatement({ ...base, balance: '-10000', activity: [], today: '2026-09-27' })
    expect(s.minimumLeft.toNumber()).toBe(500)
    expect(s.remaining.toNumber()).toBe(10000)
  })

  it('paid in full', () => {
    const s = cardStatement({ ...base, balance: '0', activity: [tx({ type: 'transfer', sub_account_id: 'bank', to_sub_account_id: CARD, date: '2026-10-01', amount: '10000', to_amount: '10000' })], today: '2026-10-02' })
    expect(s.statementBalance.toNumber()).toBe(10000)
    expect(s.remaining.toNumber()).toBe(0)
    expect(s.status).toBe('paid')
  })

  it('overdue after the due date with money left', () => {
    const s = cardStatement({ ...base, balance: '-10000', activity: [], today: '2026-10-18' })
    expect(s.status).toBe('overdue')
    expect(s.daysLeft).toBe(-3)
    expect(statementLabel(s)).toBe('Overdue by 3 days')
  })

  it('nothing to pay when the card owed nothing at the statement', () => {
    const s = cardStatement({ ...base, balance: '-1200', activity: [tx({ date: '2026-09-27', amount: '1200' })], today: '2026-09-27' })
    expect(s.statementBalance.toNumber()).toBe(0)
    expect(s.status).toBe('nothing')
    expect(s.newSpending.toNumber()).toBe(1200)
  })
})

describe('installment plans', () => {
  // an iPhone for 24,000 over 12 months with 1,200 of fees, bought 10 Sep; statement on the 25th
  const plan = { principal: '24000', fees: '1200', months: 12, purchase_date: '2026-09-10', first_billing_date: '2026-09-25' }

  it('first billed on the statement on or after the purchase', () => {
    expect(firstBillingDate('2026-09-10', 25)).toBe('2026-09-25')
    expect(firstBillingDate('2026-09-25', 25)).toBe('2026-09-25')
    expect(firstBillingDate('2026-09-26', 25)).toBe('2026-10-25')
    expect(firstBillingDate('2026-02-10', 31)).toBe('2026-02-28')
  })

  it('equal installments, one per statement, the last takes the rounding', () => {
    const s = installmentSchedule(plan, 25)
    expect(s).toHaveLength(12)
    expect(s[0]!.amount.toNumber()).toBe(2100)
    expect(s.map((i) => i.date).slice(0, 3)).toEqual(['2026-09-25', '2026-10-25', '2026-11-25'])
    expect(s[11]!.date).toBe('2027-08-25')
    const odd = installmentSchedule({ ...plan, principal: '1000', fees: '0', months: 3 }, 25)
    expect(odd.map((i) => i.amount.toNumber())).toEqual([333.33, 333.33, 333.34])
    expect(odd.reduce((a, i) => a.plus(i.amount), d(0)).toNumber()).toBe(1000)
  })

  it('progress over time', () => {
    const before = planProgress(plan, 25, '2026-09-24') // bought, nothing billed yet
    expect(before.billedCount).toBe(0)
    expect(before.unbilled.toNumber()).toBe(25200)
    expect(before.next!.date).toBe('2026-09-25')
    const after3 = planProgress(plan, 25, '2026-11-30')
    expect(after3.billedCount).toBe(3)
    expect(after3.billed.toNumber()).toBe(6300)
    expect(after3.unbilled.toNumber()).toBe(18900)
    expect(after3.next!.n).toBe(4)
    expect(planProgress(plan, 25, '2027-09-01').status).toBe('done')
    expect(planProgress(plan, 25, '2026-09-01').unbilled.toNumber()).toBe(0) // before the purchase
  })

  it('settling early bills the rest at once', () => {
    const settled = planProgress({ ...plan, closed_at: '2026-10-05' }, 25, '2026-10-05')
    expect(settled.status).toBe('settled')
    expect(settled.unbilled.toNumber()).toBe(0)
    expect(unbilledInstallments([{ ...plan, closed_at: '2026-10-05' }], 25, '2026-10-04').toNumber()).toBe(23100)
  })

  it('the statement bills only this month’s installment, not the whole purchase', () => {
    // the card: 25,200 for the phone (+fees) and 3,000 of normal spending, all before the 25 Sep statement
    const activity: CardTx[] = [tx({ date: '2026-09-10', amount: '24000' }), tx({ date: '2026-09-10', amount: '1200' }), tx({ date: '2026-09-12', amount: '3000' })]
    const unbilled = unbilledInstallments([plan], 25, '2026-09-25') // 25,200 − 2,100 billed = 23,100
    const s = cardStatement({ balance: '-28200', subId: CARD, statementDay: 25, dueDay: 15, minPct: 5, activity, today: '2026-09-27', unbilledAtStatement: unbilled })
    expect(unbilled.toNumber()).toBe(23100)
    expect(s.statementBalance.toNumber()).toBe(5100) // 3,000 + the first 2,100 installment
    expect(s.minimum.toNumber()).toBe(255)
    expect(installmentsOnStatement([plan], 25, '2026-09-25').toNumber()).toBe(2100)
    // usage still counts the full amount owed against the limit
    expect(cardUsage([d(-28200)], 50000).available!.toNumber()).toBe(21800)
  })
})

describe('usage', () => {
  it('owed, available and utilisation against the limit', () => {
    const u = cardUsage([d(-8200)], 30000)
    expect(u.owed.toNumber()).toBe(8200)
    expect(u.available!.toNumber()).toBe(21800)
    expect(u.utilization!.toFixed(1)).toBe('27.3')
  })
  it('several currencies (already converted) add up; over the limit goes negative', () => {
    const u = cardUsage([d(-25000), d(-7500)], 30000)
    expect(u.owed.toNumber()).toBe(32500)
    expect(u.available!.toNumber()).toBe(-2500)
  })
  it('a card in credit owes nothing', () => {
    const u = cardUsage([d(300)], 30000)
    expect(u.owed.toNumber()).toBe(0)
    expect(u.credit.toNumber()).toBe(300)
  })
  it('no limit set', () => {
    const u = cardUsage([d(-100)], null)
    expect(u.available).toBeNull()
    expect(u.utilization).toBeNull()
  })
})
