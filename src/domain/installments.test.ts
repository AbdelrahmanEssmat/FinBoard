import { describe, expect, it } from 'vitest'
import { debtProgress, installmentPlan, nextInstallment } from './installments'

describe('debt progress', () => {
  it('paid, remaining, percent', () => {
    const p = debtProgress({ amount: '10000' }, [{ amount: '2000', date: '2026-01-01' }, { amount: '3000', date: '2026-02-01' }])
    expect(p.paid.toString()).toBe('5000')
    expect(p.remaining.toString()).toBe('5000')
    expect(p.percent).toBe(50)
    expect(p.isSettled).toBe(false)
  })
  it('overpayment clamps to zero remaining', () => {
    const p = debtProgress({ amount: '100' }, [{ amount: '150', date: '2026-01-01' }])
    expect(p.remaining.toString()).toBe('0')
    expect(p.percent).toBe(100)
    expect(p.isSettled).toBe(true)
  })
})

describe('installment plan', () => {
  const debt = { amount: '10000', plan_count: 5, plan_amount: '2000', plan_frequency: 'monthly' as const, plan_start_date: '2026-08-01' }

  it('5 × 2000 monthly with overdue and upcoming flags', () => {
    const plan = installmentPlan(debt, [{ amount: '2000', date: '2026-08-01' }], '2026-09-26')
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])
    expect(plan.map((p) => p.status)).toEqual(['paid', 'overdue', 'upcoming', 'upcoming', 'upcoming'])
    expect(nextInstallment(plan)!.dueDate).toBe('2026-09-01')
  })
  it('partial payments are allocated oldest first', () => {
    const plan = installmentPlan(debt, [{ amount: '3000', date: '2026-08-01' }], '2026-09-01')
    expect(plan[0]!.status).toBe('paid')
    expect(plan[1]!.paid.toString()).toBe('1000')
    expect(plan[1]!.status).toBe('due')
  })
  it('last installment absorbs the rounding remainder', () => {
    const plan = installmentPlan({ amount: '10000', plan_count: 3, plan_frequency: 'monthly', plan_start_date: '2026-01-01' }, [], '2026-01-01')
    expect(plan.map((p) => p.amount.toFixed(2))).toEqual(['3333.33', '3333.33', '3333.34'])
  })
  it('no plan but a due date gives one installment; nothing otherwise', () => {
    expect(installmentPlan({ amount: '500', due_date: '2026-10-01' }, [], '2026-09-26')).toHaveLength(1)
    expect(installmentPlan({ amount: '500' }, [], '2026-09-26')).toHaveLength(0)
  })
})
