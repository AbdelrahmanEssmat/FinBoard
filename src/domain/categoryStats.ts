/**
 * Per-category analysis (the category detail page) and payer/payee totals, as pure functions.
 * Amounts are converted to one currency through `toBase`, at the rate of each transaction's date.
 * Income and spending follow the same rules as the reports (isIncome / isExpense: loans and
 * investment sales are not income or spending).
 */
import { d, Decimal } from '@/domain/money'
import { isExpense, isIncome, type CategoryLike, type DateRange, type ToBase, type TxLike } from '@/domain/insights'

export type FlowKind = 'income' | 'expense'
const flows = (t: TxLike, kind: FlowKind) => (kind === 'income' ? isIncome(t) : isExpense(t))
const inRange = (t: TxLike, r: DateRange) => t.date >= r.from && t.date <= r.to

/** The category plus its sub-categories (a parent's figures include its children). */
export function categoryFamily(id: string, categories: CategoryLike[]): Set<string> {
  return new Set([id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)])
}

/** 'YYYY-MM' keys for the `count` months ending with the month of `endIso`, oldest first. */
export function monthKeys(endIso: string, count: number): string[] {
  const [y, m] = endIso.split('-').map(Number) as [number, number]
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1 - i, 1)
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export interface MonthTotal {
  month: string
  value: Decimal
  count: number
}

/** Monthly totals for a set of categories (zero months included), oldest first. */
export function categoryMonthly(txs: TxLike[], ids: Set<string>, kind: FlowKind, months: string[], toBase: ToBase): MonthTotal[] {
  const acc = new Map(months.map((m) => [m, { month: m, value: d(0), count: 0 }]))
  for (const t of txs) {
    if (!t.category_id || !ids.has(t.category_id) || !flows(t, kind)) continue
    const row = acc.get(t.date.slice(0, 7))
    if (!row) continue
    row.value = row.value.plus(toBase(t.amount, t.currency, t.date))
    row.count++
  }
  return months.map((m) => acc.get(m)!)
}

export interface CategorySummary {
  total: Decimal
  count: number
  /** per full month, counted from the first month with any activity (so a new category isn't diluted) */
  avgPerMonth: Decimal
  activeMonths: number
  avgPerTransaction: Decimal | null
  best: MonthTotal | null
  /** the last month in the series (normally the current month) */
  latest: MonthTotal | null
  /** true when the latest month is still in progress: its figures are "so far" */
  latestIsPartial: boolean
  /**
   * latest month vs the average of the months before it, in %; null without history. For a month
   * in progress the average is prorated to the days elapsed, so mid-month it says how the month is
   * going, not how far it is from a full month's total.
   */
  latestVsAvgPct: Decimal | null
}

export function summarizeCategory(series: MonthTotal[], opts: { today?: string } = {}): CategorySummary {
  const total = series.reduce((a, m) => a.plus(m.value), d(0))
  const count = series.reduce((a, m) => a + m.count, 0)
  const first = series.findIndex((m) => m.count > 0)
  const best = series.reduce<MonthTotal | null>((b, m) => (m.count && (!b || m.value.gt(b.value)) ? m : b), null)
  const latest = series.length ? series[series.length - 1]! : null
  const latestIsPartial = Boolean(opts.today && latest && latest.month === opts.today.slice(0, 7))
  let elapsedFraction = 1
  if (latestIsPartial) {
    const [y, m, day] = opts.today!.split('-').map(Number) as [number, number, number]
    elapsedFraction = day / new Date(y, m, 0).getDate()
  }
  const active = first === -1 ? [] : series.slice(first)
  // the month in progress is left out of the per-month average (unless it is the only month)
  const full = latestIsPartial && active.length > 1 ? active.slice(0, -1) : active
  const before = first === -1 ? [] : series.slice(first, -1)
  const beforeAvg = before.length ? before.reduce((a, m) => a.plus(m.value), d(0)).div(before.length) : null
  const expected = beforeAvg?.times(elapsedFraction)
  return {
    total,
    count,
    avgPerMonth: full.length ? full.reduce((a, m) => a.plus(m.value), d(0)).div(full.length) : d(0),
    activeMonths: series.filter((m) => m.count > 0).length,
    avgPerTransaction: count ? total.div(count) : null,
    best,
    latest,
    latestIsPartial,
    latestVsAvgPct: latest && expected && expected.gt(0) ? latest.value.minus(expected).div(expected).times(100) : null,
  }
}

export interface SubcategoryTotal {
  id: string
  name: string
  value: Decimal
  count: number
  pct: number
}

/** How a parent category splits across its sub-categories ("General" = filed on the parent itself). */
export function subcategorySplit(txs: TxLike[], parent: CategoryLike, categories: CategoryLike[], kind: FlowKind, range: DateRange, toBase: ToBase): SubcategoryTotal[] {
  const children = categories.filter((c) => c.parent_id === parent.id)
  if (!children.length) return []
  const names = new Map<string, string>([[parent.id, 'General'], ...children.map((c) => [c.id, c.name] as [string, string])])
  const acc = new Map<string, { value: Decimal; count: number }>()
  for (const t of txs) {
    if (!t.category_id || !names.has(t.category_id) || !inRange(t, range) || !flows(t, kind)) continue
    const cur = acc.get(t.category_id) ?? { value: d(0), count: 0 }
    acc.set(t.category_id, { value: cur.value.plus(toBase(t.amount, t.currency, t.date)), count: cur.count + 1 })
  }
  const total = [...acc.values()].reduce((a, v) => a.plus(v.value), d(0))
  return [...acc.entries()]
    .map(([id, v]) => ({ id, name: names.get(id)!, value: v.value, count: v.count, pct: total.isZero() ? 0 : v.value.div(total).times(100).toNumber() }))
    .sort((a, b) => b.value.comparedTo(a.value))
}

export interface PartyTotal {
  name: string
  value: Decimal
  count: number
  pct: number
}

/**
 * Totals by who paid you (income, the "From" field) or who you paid (spending, "Paid to"),
 * grouped case-insensitively. `only` narrows to a set of categories.
 */
export function partyTotals(txs: TxLike[], range: DateRange, kind: FlowKind, toBase: ToBase, opts: { limit?: number; only?: Set<string> } = {}): { rows: PartyTotal[]; unnamed: Decimal; total: Decimal } {
  const acc = new Map<string, { name: string; value: Decimal; count: number }>()
  let unnamed = d(0)
  let total = d(0)
  for (const t of txs) {
    if (!inRange(t, range) || !flows(t, kind)) continue
    if (opts.only && (!t.category_id || !opts.only.has(t.category_id))) continue
    const v = toBase(t.amount, t.currency, t.date)
    total = total.plus(v)
    const name = (t.payee ?? '').trim()
    if (!name) {
      unnamed = unnamed.plus(v)
      continue
    }
    const key = name.toLowerCase()
    const cur = acc.get(key) ?? { name, value: d(0), count: 0 }
    acc.set(key, { name: cur.name, value: cur.value.plus(v), count: cur.count + 1 })
  }
  const rows = [...acc.values()]
    .sort((a, b) => b.value.comparedTo(a.value))
    .slice(0, opts.limit ?? 6)
    .map((r) => ({ ...r, pct: total.isZero() ? 0 : r.value.div(total).times(100).toNumber() }))
  return { rows, unnamed, total }
}

/** The category most recently used with each payer/payee, for suggesting a category as you type. */
export function lastCategoryByParty(txs: Pick<TxLike, 'type' | 'payee' | 'category_id' | 'date'>[]): Map<string, string> {
  const out = new Map<string, { cat: string; date: string }>()
  for (const t of txs) {
    const name = (t.payee ?? '').trim().toLowerCase()
    if (!name || !t.category_id || t.type === 'transfer') continue
    const key = `${t.type}:${name}`
    const cur = out.get(key)
    if (!cur || t.date > cur.date) out.set(key, { cat: t.category_id, date: t.date })
  }
  return new Map([...out.entries()].map(([k, v]) => [k, v.cat]))
}
