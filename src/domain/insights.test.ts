import { describe, expect, it } from 'vitest'
import { d, type NumericInput } from '@/domain/money'
import { categoryBreakdown, categoryChanges, fixedVsVariable, generateInsights, periodTotals, previousRange, spendingProjection, topPayees, weekPattern, monthlySeries } from '@/domain/insights'

const toBase = (amount: NumericInput, currency: string) => (currency === 'USD' ? d(amount).times(50) : d(amount))
const categories = new Map([
  ['food', { id: 'food', name: 'Food', parent_id: null }],
  ['rest', { id: 'rest', name: 'Restaurants', parent_id: 'food' }],
  ['rent', { id: 'rent', name: 'Rent', parent_id: null }],
  ['salary', { id: 'salary', name: 'Salary', parent_id: null }],
])
const sep = { from: '2026-09-01', to: '2026-09-30' }
const txs = [
  { id: '1', type: 'income' as const, date: '2026-09-01', amount: '20000', currency: 'EGP', category_id: 'salary' },
  { id: '2', type: 'expense' as const, date: '2026-09-02', amount: '8000', currency: 'EGP', category_id: 'rent', source: 'recurring' },
  { id: '3', type: 'expense' as const, date: '2026-09-04', amount: '1500', currency: 'EGP', category_id: 'food', payee: 'Carrefour' },
  { id: '4', type: 'expense' as const, date: '2026-09-05', amount: '500', currency: 'EGP', category_id: 'rest', payee: 'Carrefour' },
  { id: '5', type: 'expense' as const, date: '2026-09-11', amount: '20', currency: 'USD', category_id: 'rest' }, // Friday, 1000 EGP
  { id: '6', type: 'transfer' as const, date: '2026-09-12', amount: '999', currency: 'EGP', category_id: null },
  // previous period (August)
  { id: '7', type: 'expense' as const, date: '2026-08-10', amount: '8000', currency: 'EGP', category_id: 'rent' },
  { id: '8', type: 'expense' as const, date: '2026-08-12', amount: '1000', currency: 'EGP', category_id: 'food' },
]

describe('insights', () => {
  it('previous range has the same length', () => {
    expect(previousRange(sep)).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(previousRange({ from: '2026-07-01', to: '2026-09-30' })).toEqual({ from: '2026-03-31', to: '2026-06-30' })
  })
  it('period totals ignore transfers and convert currencies', () => {
    const t = periodTotals(txs, sep, toBase)
    expect(t.income.toString()).toBe('20000')
    expect(t.expense.toString()).toBe('11000')
    expect(t.net.toString()).toBe('9000')
    expect(t.savingsRate!.toString()).toBe('45')
    expect(t.days).toBe(30)
    expect(t.expenseCount).toBe(4)
  })
  it('category breakdown rolls children into parents', () => {
    const b = categoryBreakdown(txs, sep, 'expense', categories, toBase)
    expect(b.total.toString()).toBe('11000')
    expect(b.rows.map((r) => [r.name, r.value.toString()])).toEqual([
      ['Rent', '8000'],
      ['Food', '3000'],
    ])
    expect(b.rows[1]!.count).toBe(3)
  })
  it('category changes vs previous period', () => {
    const cur = categoryBreakdown(txs, sep, 'expense', categories, toBase).rows
    const prev = categoryBreakdown(txs, previousRange(sep), 'expense', categories, toBase).rows
    const ch = categoryChanges(cur, prev)
    const food = ch.find((c) => c.id === 'food')!
    expect(food.change.toString()).toBe('2000')
    expect(food.changePct!.toString()).toBe('200')
    expect(ch.find((c) => c.id === 'rent')!.change.toString()).toBe('0')
  })
  it('top payees group case-insensitively', () => {
    const p = topPayees([...txs, { id: 'x', type: 'expense', date: '2026-09-20', amount: '100', currency: 'EGP', category_id: 'food', payee: 'carrefour' }], sep, toBase)
    expect(p[0]!.name).toBe('Carrefour')
    expect(p[0]!.value.toString()).toBe('2100')
    expect(p[0]!.count).toBe(3)
  })
  it('fixed vs variable uses recurring source and fixed categories', () => {
    const fv = fixedVsVariable(txs, sep, toBase, new Set(['rent']), categories)
    expect(fv.fixed.toString()).toBe('8000')
    expect(fv.variable.toString()).toBe('3000')
    expect(Math.round(fv.fixedPct)).toBe(73)
  })
  it('projects month-end spending from the run rate', () => {
    const p = spendingProjection(txs, sep, '2026-09-15', toBase)
    expect(p.daysElapsed).toBe(15)
    expect(p.spentSoFar.toString()).toBe('11000')
    expect(p.projected.toString()).toBe('22000')
  })
  it('weekend pattern uses Friday and Saturday', () => {
    const w = weekPattern(txs, sep, toBase)
    // Sep 2026 has 8 weekend days (Fri 4/11/18/25, Sat 5/12/19/26) and 22 weekdays; ids 3, 4, 5 fall on weekends
    expect(w.weekendPerDay.toFixed(2)).toBe(d(3000).div(8).toFixed(2))
    expect(w.weekdayPerDay.toFixed(2)).toBe(d(8000).div(22).toFixed(2))
  })
  it('monthly series covers every month in range', () => {
    const s = monthlySeries(txs, { from: '2026-08-01', to: '2026-09-30' }, toBase)
    expect(s.map((m) => m.key)).toEqual(['2026-08', '2026-09'])
    expect(s[0]!.expense.toString()).toBe('9000')
    expect(s[1]!.income.toString()).toBe('20000')
  })
  it('generates plain-language insights', () => {
    const ins = generateInsights({
      txs,
      range: sep,
      today: '2026-09-30',
      toBase,
      categories,
      fixedCategoryIds: new Set(['rent']),
      money: (v) => `E£ ${d(v).toFixed(0)}`,
      isCurrentMonth: false,
      netWorthChange: { total: d(12000), fromSavings: d(9000) },
      budgetsOver: ['Food'],
    })
    const ids = ins.map((i) => i.id)
    expect(ids).toContain('savings')
    expect(ins.find((i) => i.id === 'savings')!.title).toBe('You saved 45% of your income')
    expect(ins.find((i) => i.id === 'spend-vs-prev')!.title).toMatch(/22% higher/)
    expect(ins.find((i) => i.id === 'top-category')!.title).toBe('Rent is your biggest expense at 73%')
    expect(ins.find((i) => i.id === 'riser')!.title).toBe('Food rose the most: +E£ 2000')
    expect(ins.find((i) => i.id === 'fixed')!.title).toBe('Fixed commitments take 73% of spending')
    expect(ins.find((i) => i.id === 'payee')!.title).toBe('Most spent at Carrefour: E£ 2000')
    expect(ins.find((i) => i.id === 'largest')!.title).toBe('One expense was 73% of all spending')
    expect(ins.find((i) => i.id === 'networth')!.detail).toBe('E£ 9000 from saving, +E£ 3000 from changes in asset values and rates.')
    expect(ins.find((i) => i.id === 'budgets')!.detail).toBe('Food')
  })
})
