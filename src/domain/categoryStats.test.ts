import { describe, expect, it } from 'vitest'
import { d, type NumericInput } from '@/domain/money'
import { categoryFamily, categoryMonthly, lastCategoryByParty, monthKeys, partyTotals, subcategorySplit, summarizeCategory } from '@/domain/categoryStats'
import type { TxLike } from '@/domain/insights'

const toBase = (amount: NumericInput, currency: string) => (currency === 'USD' ? d(amount).times(50) : d(amount))
const cats = [
  { id: 'concert', name: 'Concert', parent_id: null },
  { id: 'weddings', name: 'Weddings', parent_id: 'concert' },
  { id: 'clubs', name: 'Clubs', parent_id: 'concert' },
  { id: 'salary', name: 'Salary', parent_id: null },
  { id: 'food', name: 'Food', parent_id: null },
]
let n = 0
const tx = (over: Partial<TxLike>): TxLike => ({ id: String(n++), type: 'income', date: '2026-09-10', amount: '1000', currency: 'EGP', category_id: 'concert', payee: null, ...over })

const txs: TxLike[] = [
  tx({ date: '2026-07-05', amount: '4000', category_id: 'weddings', payee: 'Four Seasons' }),
  tx({ date: '2026-08-12', amount: '3000', category_id: 'clubs', payee: 'Cairo Jazz Club' }),
  tx({ date: '2026-08-20', amount: '100', currency: 'USD', category_id: 'concert', payee: 'cairo jazz club' }), // 5000 EGP
  tx({ date: '2026-09-02', amount: '2000', category_id: 'weddings', payee: 'Four Seasons' }),
  tx({ date: '2026-09-15', amount: '9000', category_id: 'salary', payee: 'Studio' }),
  tx({ date: '2026-09-16', amount: '500', category_id: 'concert', source: 'debt' }), // a loan, not income
  tx({ date: '2026-09-18', type: 'expense', amount: '300', category_id: 'food', payee: 'Carrefour' }),
]

describe('category analysis', () => {
  it('month keys end with the given month', () => {
    expect(monthKeys('2026-09-27', 3)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(monthKeys('2026-02-10', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('a parent includes its sub-categories; loans are not income', () => {
    const fam = categoryFamily('concert', cats)
    expect([...fam].sort()).toEqual(['clubs', 'concert', 'weddings'])
    const series = categoryMonthly(txs, fam, 'income', monthKeys('2026-09-27', 6), toBase)
    expect(series.map((m) => m.value.toNumber())).toEqual([0, 0, 0, 4000, 8000, 2000])
    expect(series.map((m) => m.count)).toEqual([0, 0, 0, 1, 2, 1])
  })

  it('summary: average from the first active month, best month, latest vs earlier average', () => {
    const series = categoryMonthly(txs, categoryFamily('concert', cats), 'income', monthKeys('2026-09-27', 6), toBase)
    const s = summarizeCategory(series)
    expect(s.total.toNumber()).toBe(14000)
    expect(s.count).toBe(4)
    expect(s.avgPerMonth.toNumber()).toBeCloseTo(14000 / 3) // Jul, Aug, Sep, not the empty months before
    expect(s.activeMonths).toBe(3)
    expect(s.avgPerTransaction!.toNumber()).toBe(3500)
    expect(s.best!.month).toBe('2026-08')
    expect(s.latest!.month).toBe('2026-09')
    // Sep 2000 vs the average of Jul–Aug (6000) = −66.7%
    expect(s.latestVsAvgPct!.toFixed(1)).toBe('-66.7')
  })

  it('a month in progress: average over full months, "vs usual" prorated to the days elapsed', () => {
    const series = categoryMonthly(txs, categoryFamily('concert', cats), 'income', monthKeys('2026-09-15', 6), toBase)
    const s = summarizeCategory(series, { today: '2026-09-15' })
    expect(s.latestIsPartial).toBe(true)
    expect(s.avgPerMonth.toNumber()).toBe(6000) // Jul + Aug only
    // half of September: 2000 so far vs half of the usual 6000 = −33.3%
    expect(s.latestVsAvgPct!.toFixed(1)).toBe('-33.3')
    // the series ends in a finished month: nothing is prorated
    const done = summarizeCategory(series, { today: '2026-10-05' })
    expect(done.latestIsPartial).toBe(false)
    expect(done.avgPerMonth.toNumber()).toBeCloseTo(14000 / 3)
    expect(done.latestVsAvgPct!.toFixed(1)).toBe('-66.7')
    // a category whose only month is the current one still shows that month as its average
    const only = summarizeCategory(categoryMonthly(txs, new Set(['salary']), 'income', monthKeys('2026-09-15', 3), toBase), { today: '2026-09-15' })
    expect(only.avgPerMonth.toNumber()).toBe(9000)
    expect(only.latestVsAvgPct).toBeNull()
  })

  it('empty category', () => {
    const s = summarizeCategory(categoryMonthly([], new Set(['x']), 'income', monthKeys('2026-09-27', 3), toBase))
    expect(s.total.toNumber()).toBe(0)
    expect(s.best).toBeNull()
    expect(s.avgPerTransaction).toBeNull()
    expect(s.latestVsAvgPct).toBeNull()
  })

  it('sub-category split, with "General" for amounts filed on the parent', () => {
    const rows = subcategorySplit(txs, cats[0]!, cats, 'income', { from: '2026-07-01', to: '2026-09-30' }, toBase)
    expect(rows.map((r) => [r.name, r.value.toNumber()])).toEqual([
      ['Weddings', 6000],
      ['General', 5000],
      ['Clubs', 3000],
    ])
    expect(Math.round(rows.reduce((a, r) => a + r.pct, 0))).toBe(100)
    expect(subcategorySplit(txs, cats[3]!, cats, 'income', { from: '2026-07-01', to: '2026-09-30' }, toBase)).toEqual([])
  })
})

describe('who pays you / who you pay', () => {
  it('income by payer, case-insensitive, with unnamed amounts kept apart', () => {
    const r = partyTotals([...txs, tx({ date: '2026-09-20', amount: '700', payee: '  ' })], { from: '2026-07-01', to: '2026-09-30' }, 'income', toBase)
    expect(r.rows.map((x) => [x.name, x.value.toNumber(), x.count])).toEqual([
      ['Studio', 9000, 1],
      ['Cairo Jazz Club', 8000, 2],
      ['Four Seasons', 6000, 2],
    ])
    expect(r.unnamed.toNumber()).toBe(700)
    expect(r.total.toNumber()).toBe(23700)
  })
  it('can be narrowed to a category family', () => {
    const r = partyTotals(txs, { from: '2026-07-01', to: '2026-09-30' }, 'income', toBase, { only: categoryFamily('concert', cats) })
    expect(r.rows.map((x) => x.name)).toEqual(['Cairo Jazz Club', 'Four Seasons'])
    expect(r.total.toNumber()).toBe(14000)
  })
  it('spending by payee', () => {
    const r = partyTotals(txs, { from: '2026-09-01', to: '2026-09-30' }, 'expense', toBase)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.name).toBe('Carrefour')
  })
  it('remembers the latest category used with each payer', () => {
    const m = lastCategoryByParty([
      { type: 'income', payee: 'Four Seasons', category_id: 'concert', date: '2026-07-01' },
      { type: 'income', payee: 'four seasons', category_id: 'weddings', date: '2026-09-01' },
      { type: 'expense', payee: 'Four Seasons', category_id: 'food', date: '2026-08-01' },
    ])
    expect(m.get('income:four seasons')).toBe('weddings')
    expect(m.get('expense:four seasons')).toBe('food')
  })
})
