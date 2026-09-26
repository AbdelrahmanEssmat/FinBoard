/**
 * Report insights: pure calculations over a list of transactions.
 * Everything is converted to one currency through the `toBase` callback the caller provides.
 */
import { d, Decimal, type NumericInput } from '@/domain/money'
import { daysBetween } from '@/utils/dates'

export interface TxLike {
  id: string
  type: 'income' | 'expense' | 'transfer'
  date: string
  amount: NumericInput
  currency: string
  category_id: string | null
  payee?: string | null
  notes?: string | null
  source?: string
}
export interface CategoryLike {
  id: string
  name: string
  parent_id: string | null
  color?: string
  icon?: string
}
export interface DateRange {
  from: string
  to: string
}
export type ToBase = (amount: NumericInput, currency: string) => Decimal

const inRange = (t: TxLike, r: DateRange) => t.date >= r.from && t.date <= r.to
const ZERO = () => d(0)

/** Previous period of the same length, ending the day before `range.from`. */
export function previousRange(range: DateRange): DateRange {
  const len = daysBetween(range.from, range.to)
  const to = shift(range.from, -1)
  return { from: shift(to, -len), to }
}
function shift(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00')
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export interface PeriodTotals {
  income: Decimal
  expense: Decimal
  net: Decimal
  /** net / income, as a percentage; null when there is no income */
  savingsRate: Decimal | null
  days: number
  avgDailySpend: Decimal
  expenseCount: number
  incomeCount: number
}

export function periodTotals(txs: TxLike[], range: DateRange, toBase: ToBase): PeriodTotals {
  let income = ZERO()
  let expense = ZERO()
  let expenseCount = 0
  let incomeCount = 0
  for (const t of txs) {
    if (!inRange(t, range)) continue
    if (t.type === 'income') {
      income = income.plus(toBase(t.amount, t.currency))
      incomeCount++
    } else if (t.type === 'expense') {
      expense = expense.plus(toBase(t.amount, t.currency))
      expenseCount++
    }
  }
  const days = Math.max(1, daysBetween(range.from, range.to) + 1)
  const net = income.minus(expense)
  return { income, expense, net, savingsRate: income.isZero() ? null : net.div(income).times(100), days, avgDailySpend: expense.div(days), expenseCount, incomeCount }
}

export interface CategoryTotal {
  id: string
  name: string
  color: string
  icon: string
  value: Decimal
  pct: number
  count: number
}

/** Totals per top-level category (children roll up into their parent). */
export function categoryBreakdown(txs: TxLike[], range: DateRange, kind: 'income' | 'expense', categories: Map<string, CategoryLike>, toBase: ToBase): { total: Decimal; rows: CategoryTotal[] } {
  const acc = new Map<string, { value: Decimal; count: number }>()
  for (const t of txs) {
    if (!inRange(t, range) || t.type !== kind) continue
    const cat = t.category_id ? categories.get(t.category_id) : undefined
    const key = cat?.parent_id ?? cat?.id ?? 'none'
    const cur = acc.get(key) ?? { value: ZERO(), count: 0 }
    acc.set(key, { value: cur.value.plus(toBase(t.amount, t.currency)), count: cur.count + 1 })
  }
  const total = [...acc.values()].reduce((a, v) => a.plus(v.value), ZERO())
  const rows = [...acc.entries()]
    .map(([id, v]) => {
      const cat = categories.get(id)
      return { id, name: cat?.name ?? 'Uncategorised', color: cat?.color ?? '#94a3b8', icon: cat?.icon ?? 'tag', value: v.value, count: v.count, pct: total.isZero() ? 0 : v.value.div(total).times(100).toNumber() }
    })
    .sort((a, b) => b.value.comparedTo(a.value))
  return { total, rows }
}

export interface CategoryChange extends CategoryTotal {
  previous: Decimal
  change: Decimal
  changePct: Decimal | null
}

/** Current vs previous period per category, sorted by the size of the change. */
export function categoryChanges(current: CategoryTotal[], previous: CategoryTotal[]): CategoryChange[] {
  const prev = new Map(previous.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const out: CategoryChange[] = []
  for (const c of current) {
    seen.add(c.id)
    const p = prev.get(c.id)?.value ?? ZERO()
    out.push({ ...c, previous: p, change: c.value.minus(p), changePct: p.isZero() ? null : c.value.minus(p).div(p).times(100) })
  }
  for (const p of previous) {
    if (seen.has(p.id)) continue
    out.push({ ...p, value: ZERO(), pct: 0, count: 0, previous: p.value, change: p.value.neg(), changePct: d(-100) })
  }
  return out.sort((a, b) => b.change.abs().comparedTo(a.change.abs()))
}

export interface PayeeTotal {
  name: string
  value: Decimal
  count: number
}

export function topPayees(txs: TxLike[], range: DateRange, toBase: ToBase, limit = 5): PayeeTotal[] {
  const acc = new Map<string, PayeeTotal>()
  for (const t of txs) {
    if (!inRange(t, range) || t.type !== 'expense') continue
    const name = (t.payee ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const cur = acc.get(key) ?? { name, value: ZERO(), count: 0 }
    acc.set(key, { name: cur.name, value: cur.value.plus(toBase(t.amount, t.currency)), count: cur.count + 1 })
  }
  return [...acc.values()].sort((a, b) => b.value.comparedTo(a.value)).slice(0, limit)
}

export function largestTransactions(txs: TxLike[], range: DateRange, toBase: ToBase, limit = 5): (TxLike & { base: Decimal })[] {
  return txs
    .filter((t) => inRange(t, range) && t.type === 'expense')
    .map((t) => ({ ...t, base: toBase(t.amount, t.currency) }))
    .sort((a, b) => b.base.comparedTo(a.base))
    .slice(0, limit)
}

export interface FixedVariable {
  fixed: Decimal
  variable: Decimal
  fixedPct: number
}

/** Fixed = posted by a recurring rule, or in a category that has a recurring rule (rent, subscriptions…). */
export function fixedVsVariable(txs: TxLike[], range: DateRange, toBase: ToBase, fixedCategoryIds: Set<string>, categories: Map<string, CategoryLike>): FixedVariable {
  let fixed = ZERO()
  let variable = ZERO()
  for (const t of txs) {
    if (!inRange(t, range) || t.type !== 'expense') continue
    const cat = t.category_id ? categories.get(t.category_id) : undefined
    const parent = cat?.parent_id ?? cat?.id
    const isFixed = t.source === 'recurring' || (t.category_id !== null && fixedCategoryIds.has(t.category_id)) || (parent !== undefined && fixedCategoryIds.has(parent))
    const v = toBase(t.amount, t.currency)
    if (isFixed) fixed = fixed.plus(v)
    else variable = variable.plus(v)
  }
  const total = fixed.plus(variable)
  return { fixed, variable, fixedPct: total.isZero() ? 0 : fixed.div(total).times(100).toNumber() }
}

export interface Projection {
  spentSoFar: Decimal
  daysElapsed: number
  daysInPeriod: number
  avgDaily: Decimal
  projected: Decimal
}

/** Run-rate projection for a period still in progress (e.g. this month). */
export function spendingProjection(txs: TxLike[], range: DateRange, today: string, toBase: ToBase): Projection {
  const totals = periodTotals(txs, { from: range.from, to: today < range.to ? today : range.to }, toBase)
  const daysInPeriod = daysBetween(range.from, range.to) + 1
  const daysElapsed = Math.min(daysInPeriod, Math.max(1, daysBetween(range.from, today) + 1))
  const avgDaily = totals.expense.div(daysElapsed)
  return { spentSoFar: totals.expense, daysElapsed, daysInPeriod, avgDaily, projected: avgDaily.times(daysInPeriod) }
}

export interface WeekPattern {
  weekdayPerDay: Decimal
  weekendPerDay: Decimal
  /** weekend per-day spend vs weekday, as percentage difference; null if no weekday spend */
  weekendVsWeekdayPct: Decimal | null
}

export function weekPattern(txs: TxLike[], range: DateRange, toBase: ToBase): WeekPattern {
  let weekday = ZERO()
  let weekend = ZERO()
  let weekdayDays = 0
  let weekendDays = 0
  const days = daysBetween(range.from, range.to) + 1
  for (let i = 0; i < days; i++) {
    const dow = new Date(shift(range.from, i) + 'T00:00:00').getDay()
    if (dow === 5 || dow === 6) weekendDays++ // Egyptian weekend: Friday + Saturday
    else weekdayDays++
  }
  for (const t of txs) {
    if (!inRange(t, range) || t.type !== 'expense') continue
    const dow = new Date(t.date + 'T00:00:00').getDay()
    const v = toBase(t.amount, t.currency)
    if (dow === 5 || dow === 6) weekend = weekend.plus(v)
    else weekday = weekday.plus(v)
  }
  const weekdayPerDay = weekdayDays ? weekday.div(weekdayDays) : ZERO()
  const weekendPerDay = weekendDays ? weekend.div(weekendDays) : ZERO()
  return { weekdayPerDay, weekendPerDay, weekendVsWeekdayPct: weekdayPerDay.isZero() ? null : weekendPerDay.minus(weekdayPerDay).div(weekdayPerDay).times(100) }
}

export interface MonthPoint {
  key: string // YYYY-MM
  label: string
  income: Decimal
  expense: Decimal
}

/** Income and expense per calendar month for the months touching the range (oldest first). */
export function monthlySeries(txs: TxLike[], range: DateRange, toBase: ToBase): MonthPoint[] {
  const out = new Map<string, MonthPoint>()
  let cur = new Date(range.from.slice(0, 7) + '-01T00:00:00')
  const end = new Date(range.to.slice(0, 7) + '-01T00:00:00')
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
    out.set(key, { key, label: cur.toLocaleDateString('en-GB', { month: 'short' }), income: ZERO(), expense: ZERO() })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  for (const t of txs) {
    if (!inRange(t, range)) continue
    const p = out.get(t.date.slice(0, 7))
    if (!p) continue
    if (t.type === 'income') p.income = p.income.plus(toBase(t.amount, t.currency))
    else if (t.type === 'expense') p.expense = p.expense.plus(toBase(t.amount, t.currency))
  }
  return [...out.values()]
}

/* ------------------------------------------------------------------ */
/* Plain-language insights                                             */
/* ------------------------------------------------------------------ */

export interface Insight {
  id: string
  tone: 'good' | 'warn' | 'info'
  title: string
  detail?: string
}

export interface InsightContext {
  txs: TxLike[]
  range: DateRange
  today: string
  toBase: ToBase
  categories: Map<string, CategoryLike>
  fixedCategoryIds: Set<string>
  /** formats a base-currency amount for display */
  money: (v: NumericInput) => string
  /** true when the range is the current, unfinished month */
  isCurrentMonth: boolean
  /** previous-month spending, for the projection comparison */
  netWorthChange?: { total: Decimal; fromSavings: Decimal } | null
  budgetsOver?: string[]
}

export function generateInsights(ctx: InsightContext): Insight[] {
  const { txs, range, toBase, categories, money } = ctx
  const prevRange = previousRange(range)
  const cur = periodTotals(txs, range, toBase)
  const prev = periodTotals(txs, prevRange, toBase)
  const out: Insight[] = []
  const pct = (v: Decimal) => `${v.abs().toFixed(0)}%`

  if (cur.income.gt(0)) {
    const rate = cur.savingsRate!
    if (cur.net.lt(0)) out.push({ id: 'overspent', tone: 'warn', title: `You spent ${money(cur.net.abs())} more than you earned`, detail: 'Income did not cover spending in this period.' })
    else if (rate.gte(20)) out.push({ id: 'savings', tone: 'good', title: `You saved ${pct(rate)} of your income`, detail: `${money(cur.net)} kept out of ${money(cur.income)} earned.` })
    else out.push({ id: 'savings', tone: rate.lt(10) ? 'warn' : 'info', title: `You saved ${pct(rate)} of your income`, detail: rate.lt(10) ? 'Under 10%. Trimming one variable category would lift this quickly.' : `${money(cur.net)} kept out of ${money(cur.income)} earned.` })
  }

  if (prev.expense.gt(0) && cur.expense.gt(0) && !ctx.isCurrentMonth) {
    const change = cur.expense.minus(prev.expense)
    const p = change.div(prev.expense).times(100)
    if (p.abs().gte(5)) out.push({ id: 'spend-vs-prev', tone: change.lt(0) ? 'good' : 'warn', title: `Spending is ${pct(p)} ${change.lt(0) ? 'lower' : 'higher'} than the previous period`, detail: `${money(cur.expense)} vs ${money(prev.expense)} before.` })
    else out.push({ id: 'spend-vs-prev', tone: 'info', title: 'Spending is in line with the previous period', detail: `${money(cur.expense)} vs ${money(prev.expense)} before.` })
  }

  if (ctx.isCurrentMonth && cur.expense.gt(0)) {
    const proj = spendingProjection(txs, range, ctx.today, toBase)
    if (proj.daysElapsed >= 5 && proj.daysElapsed < proj.daysInPeriod) {
      const vsPrev = prev.expense.gt(0) ? proj.projected.minus(prev.expense) : null
      out.push({
        id: 'projection',
        tone: vsPrev && vsPrev.gt(prev.expense.times(0.1)) ? 'warn' : 'info',
        title: `On track to spend about ${money(proj.projected)} this month`,
        detail: `${money(proj.avgDaily)} a day so far` + (vsPrev ? `, ${vsPrev.gte(0) ? money(vsPrev) + ' more' : money(vsPrev.abs()) + ' less'} than last month.` : '.'),
      })
    }
  }

  const cats = categoryBreakdown(txs, range, 'expense', categories, toBase)
  const top = cats.rows[0]
  if (top && cats.total.gt(0)) out.push({ id: 'top-category', tone: 'info', title: `${top.name} is your biggest expense at ${top.pct.toFixed(0)}%`, detail: `${money(top.value)} across ${top.count} transaction${top.count === 1 ? '' : 's'}.` })

  const prevCats = categoryBreakdown(txs, prevRange, 'expense', categories, toBase)
  const changes = categoryChanges(cats.rows, prevCats.rows).filter((c) => c.previous.gt(0) || c.value.gt(0))
  const riser = changes.find((c) => c.change.gt(0) && c.previous.gt(0) && c.change.gte(cats.total.times(0.05)))
  if (riser && !ctx.isCurrentMonth) out.push({ id: 'riser', tone: 'warn', title: `${riser.name} rose the most: +${money(riser.change)}`, detail: riser.changePct ? `${pct(riser.changePct)} more than the previous period.` : undefined })
  const faller = changes.find((c) => c.change.lt(0) && c.change.abs().gte(cats.total.times(0.05)))
  if (faller && !ctx.isCurrentMonth) out.push({ id: 'faller', tone: 'good', title: `${faller.name} fell by ${money(faller.change.abs())}`, detail: faller.changePct ? `${pct(faller.changePct)} less than the previous period.` : undefined })

  const fv = fixedVsVariable(txs, range, toBase, ctx.fixedCategoryIds, categories)
  if (fv.fixed.gt(0) && cur.expense.gt(0)) out.push({ id: 'fixed', tone: fv.fixedPct > 60 ? 'warn' : 'info', title: `Fixed commitments take ${fv.fixedPct.toFixed(0)}% of spending`, detail: `${money(fv.fixed)} on rent, subscriptions and other recurring bills; ${money(fv.variable)} is discretionary.` })

  const payees = topPayees(txs, range, toBase, 1)
  if (payees[0] && payees[0].count >= 2) out.push({ id: 'payee', tone: 'info', title: `Most spent at ${payees[0].name}: ${money(payees[0].value)}`, detail: `${payees[0].count} transactions.` })

  const wk = weekPattern(txs, range, toBase)
  if (wk.weekendVsWeekdayPct && wk.weekendVsWeekdayPct.abs().gte(25) && cur.expenseCount >= 8) {
    const more = wk.weekendVsWeekdayPct.gt(0)
    out.push({ id: 'weekend', tone: 'info', title: `You spend ${pct(wk.weekendVsWeekdayPct)} ${more ? 'more' : 'less'} per day on weekends`, detail: `${money(wk.weekendPerDay)} a day Fri–Sat vs ${money(wk.weekdayPerDay)} on weekdays.` })
  }

  const biggest = largestTransactions(txs, range, toBase, 1)[0]
  if (biggest && cats.total.gt(0) && biggest.base.gte(cats.total.times(0.2))) {
    const cat = biggest.category_id ? categories.get(biggest.category_id) : undefined
    out.push({ id: 'largest', tone: 'info', title: `One expense was ${biggest.base.div(cats.total).times(100).toFixed(0)}% of all spending`, detail: `${money(biggest.base)}${cat ? ' · ' + cat.name : ''}${biggest.payee ? ' · ' + biggest.payee : ''}.` })
  }

  const incomeCats = categoryBreakdown(txs, range, 'income', categories, toBase)
  if (incomeCats.rows.length >= 2 && incomeCats.rows[0]!.pct >= 85) out.push({ id: 'income-concentration', tone: 'info', title: `${incomeCats.rows[0]!.pct.toFixed(0)}% of income comes from ${incomeCats.rows[0]!.name}`, detail: 'A single source; worth keeping an eye on.' })

  if (ctx.netWorthChange) {
    const { total, fromSavings } = ctx.netWorthChange
    const valuation = total.minus(fromSavings)
    if (!total.isZero()) out.push({ id: 'networth', tone: total.gt(0) ? 'good' : 'warn', title: `Net worth ${total.gt(0) ? 'grew' : 'fell'} by ${money(total.abs())}`, detail: `${money(fromSavings)} from saving, ${valuation.gte(0) ? '+' : '-'}${money(valuation.abs())} from changes in asset values and rates.` })
  }

  if (ctx.budgetsOver?.length) out.push({ id: 'budgets', tone: 'warn', title: `${ctx.budgetsOver.length} budget${ctx.budgetsOver.length === 1 ? '' : 's'} over the limit`, detail: ctx.budgetsOver.join(', ') })

  return out
}
