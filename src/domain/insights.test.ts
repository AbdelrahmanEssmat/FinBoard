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
  it('previous range is the previous calendar period', () => {
    // whole calendar months map to whole calendar months (Aug 1 is not dropped)
    expect(previousRange(sep)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(previousRange({ from: '2026-07-01', to: '2026-09-30' })).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(previousRange({ from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    // any other range: same number of days just before it
    expect(previousRange({ from: '2026-09-10', to: '2026-09-19' })).toEqual({ from: '2026-08-31', to: '2026-09-09' })
  })
  it('money borrowed, lent or repaid is not income or spending', () => {
    const withDebt = [
      ...txs,
      { id: 'b1', type: 'income' as const, date: '2026-09-03', amount: '50000', currency: 'EGP', category_id: null, source: 'debt' },
      { id: 'b2', type: 'expense' as const, date: '2026-09-20', amount: '5000', currency: 'EGP', category_id: null, source: 'debt' },
    ]
    const t = periodTotals(withDebt, sep, toBase)
    expect(t.income.toString()).toBe('20000')
    expect(t.expense.toString()).toBe('11000')
    expect(categoryBreakdown(withDebt, sep, 'income', categories, toBase).total.toString()).toBe('20000')
    expect(monthlySeries(withDebt, sep, toBase)[0]!.income.toString()).toBe('20000')
  })
  it('the side of a transfer left after its other balance was deleted is not income or spending', () => {
    const withDetached = [
      ...txs,
      { id: 'x1', type: 'income' as const, date: '2026-09-04', amount: '3000', currency: 'EGP', category_id: null, source: 'detached_transfer' },
      { id: 'x2', type: 'expense' as const, date: '2026-09-05', amount: '2000', currency: 'EGP', category_id: null, source: 'detached_transfer' },
    ]
    const t = periodTotals(withDetached, sep, toBase)
    expect(t.income.toString()).toBe('20000')
    expect(t.expense.toString()).toBe('11000')
  })
  it("conversion uses each transaction's own date", () => {
    const byDate = (amount: NumericInput, currency: string, date: string) => (currency === 'USD' ? d(amount).times(date < '2026-09-10' ? 48 : 50) : d(amount))
    const t = periodTotals([
      { id: 'u1', type: 'expense', date: '2026-09-05', amount: '10', currency: 'USD', category_id: null },
      { id: 'u2', type: 'expense', date: '2026-09-15', amount: '10', currency: 'USD', category_id: null },
    ], sep, byDate)
    expect(t.expense.toString()).toBe('980')
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
  it('per-day spending counts only the days that have happened', () => {
    const t = periodTotals(txs, sep, toBase, '2026-09-15')
    expect(t.days).toBe(15)
    expect(t.avgDailySpend.toFixed(2)).toBe(d(11000).div(15).toFixed(2))
    // a finished period is unaffected by today
    expect(periodTotals(txs, sep, toBase, '2026-10-20').days).toBe(30)
  })
  it('compares with the given previous range when one is passed', () => {
    const base = { txs, range: sep, today: '2026-09-30', toBase, categories, fixedCategoryIds: new Set(['rent']), money: (v: NumericInput) => `E£ ${d(v).toFixed(0)}`, isCurrentMonth: false }
    const whole = generateInsights(base).find((i) => i.id === 'spend-vs-prev')!
    // only the first 11 days of August: rent (Aug 10) counted, food (Aug 12) not
    const trimmed = generateInsights({ ...base, prevRange: { from: '2026-08-01', to: '2026-08-11' } }).find((i) => i.id === 'spend-vs-prev')!
    expect(whole.detail).toBe('E£ 11000 vs E£ 9000 before.')
    expect(trimmed.detail).toBe('E£ 11000 vs E£ 8000 before.')
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

describe('the net worth change', () => {
  const ctx = { txs, range: sep, today: '2026-09-30', toBase, categories, fixedCategoryIds: new Set(['rent']), money: (v: NumericInput) => `E£ ${d(v).toFixed(0)}`, isCurrentMonth: false }
  it('debts saved without moving money are not put down to asset values', () => {
    // 9,000 saved; someone now owes you 5,000 that never left an account; prices fell 2,000
    const ins = generateInsights({ ...ctx, netWorthChange: { total: d(12000), fromSavings: d(9000), fromDebts: d(5000) } })
    expect(ins.find((i) => i.id === 'networth')!.detail).toBe('E£ 9000 from saving, +E£ 5000 from debts saved without moving money, -E£ 2000 from changes in asset values and rates.')
  })
  it('without such debts the explanation is unchanged', () => {
    const ins = generateInsights({ ...ctx, netWorthChange: { total: d(12000), fromSavings: d(9000), fromDebts: d(0) } })
    expect(ins.find((i) => i.id === 'networth')!.detail).toBe('E£ 9000 from saving, +E£ 3000 from changes in asset values and rates.')
  })
})

describe('a month in progress', () => {
  it('the projection is compared with the whole of last month', () => {
    const ctx = { txs, range: sep, today: '2026-09-15', toBase, categories, fixedCategoryIds: new Set(['rent']), money: (v: NumericInput) => `E£ ${d(v).toFixed(0)}`, isCurrentMonth: true }
    const proj = spendingProjection(txs, sep, '2026-09-15', toBase)
    // the trimmed comparison range (1–11 Aug: 8,000) is for "vs same days"; the projection uses all of August (9,000)
    const insight = generateInsights({ ...ctx, prevRange: { from: '2026-08-01', to: '2026-08-11' } }).find((i) => i.id === 'projection')!
    expect(insight.detail).toContain(`E£ ${proj.projected.minus(9000).toFixed(0)} more than last month`)
  })
  it('per-day spending and "so far" totals leave out future-dated entries', () => {
    const withFuture = [...txs, { id: 'f', type: 'expense' as const, date: '2026-09-28', amount: '15000', currency: 'EGP', category_id: 'rent' }]
    const t = periodTotals(withFuture, sep, toBase, '2026-09-15')
    expect(t.expense.toString()).toBe('26000')
    expect(t.expenseToDate.toString()).toBe('11000')
    expect(t.avgDailySpend.toFixed(2)).toBe(d(11000).div(15).toFixed(2))
  })
})
