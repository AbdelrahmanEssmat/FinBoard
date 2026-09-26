/**
 * Holdings (stocks, funds…) and their sales: pure calculations for profit/loss and performance.
 * The sale formulas match public.sell_holding exactly:
 *   cost basis = buy price per unit × units, proceeds = units × sell price − fees,
 *   realized profit/loss = proceeds − cost basis.
 */
import { d, Decimal, roundMoney, type NumericInput } from '@/domain/money'
import { daysBetween, toIsoDate } from '@/utils/dates'

export interface HoldingLike {
  id: string
  name: string
  category_id: string | null
  units: NumericInput
  avg_cost: NumericInput
  current_price: NumericInput
  currency: string
}

export interface SaleLike {
  id: string
  holding_id: string
  date: string
  units: NumericInput
  sell_price: NumericInput
  fees: NumericInput
  avg_cost: NumericInput
  cost_basis: NumericInput
  proceeds: NumericInput
  realized: NumericInput
  currency: string
  bought_at?: string | null
}

export interface SalePreview {
  costBasis: Decimal
  proceeds: Decimal
  realized: Decimal
  /** realized as % of what was paid; null when nothing was paid */
  realizedPct: Decimal | null
}

/** What a sale would book, before it is saved. */
export function previewSale(avgCost: NumericInput, units: NumericInput, sellPrice: NumericInput, fees: NumericInput = 0): SalePreview {
  const costBasis = roundMoney(d(avgCost).times(d(units)), 4)
  const proceeds = roundMoney(d(units).times(d(sellPrice)).minus(d(fees)), 4)
  const realized = proceeds.minus(costBasis)
  return { costBasis, proceeds, realized, realizedPct: costBasis.isZero() ? null : realized.div(costBasis).times(100) }
}

/** Open (unrealized) position: value now, what it cost, and the paper profit/loss. */
export function openPosition(h: Pick<HoldingLike, 'units' | 'avg_cost' | 'current_price'>) {
  const value = d(h.units).times(d(h.current_price))
  const cost = d(h.units).times(d(h.avg_cost))
  const pl = value.minus(cost)
  return { value, cost, pl, plPct: cost.isZero() ? null : pl.div(cost).times(100) }
}

export function saleReturnPct(s: SaleLike): Decimal | null {
  const cost = d(s.cost_basis)
  return cost.isZero() ? null : d(s.realized).div(cost).times(100)
}

/** Days between the purchase date and the sale; null when the purchase date is unknown. */
export function holdingDays(s: Pick<SaleLike, 'date' | 'bought_at'>): number | null {
  if (!s.bought_at) return null
  return Math.max(0, daysBetween(s.bought_at, s.date))
}

/**
 * Yearly-equivalent return, (proceeds / cost)^(365 / days) − 1. Only shown for holding
 * periods of at least 30 days: annualising a few days' move gives meaningless numbers.
 */
export function annualizedReturn(s: SaleLike): Decimal | null {
  const days = holdingDays(s)
  const cost = d(s.cost_basis)
  const proceeds = d(s.proceeds)
  if (days === null || days < 30 || cost.lte(0) || proceeds.lt(0)) return null
  return d(Math.pow(proceeds.div(cost).toNumber(), 365 / days) - 1).times(100)
}

export interface CategoryPerformance {
  id: string
  name: string
  realized: Decimal
  unrealized: Decimal
  value: Decimal
  trades: number
}

export interface PerformanceSummary<S extends SaleLike = SaleLike> {
  realized: Decimal
  /** cost of everything sold, for the realized % */
  soldCost: Decimal
  realizedPct: Decimal | null
  unrealized: Decimal
  openValue: Decimal
  openCost: Decimal
  unrealizedPct: Decimal | null
  trades: number
  wins: number
  losses: number
  /** share of sales that made money, 0–100; null before the first sale */
  winRate: number | null
  best: (S & { base: Decimal }) | null
  worst: (S & { base: Decimal }) | null
  /** average holding period of sales with a known purchase date */
  avgHoldingDays: number | null
  byCategory: CategoryPerformance[]
}

/**
 * Performance across all holdings in one currency. Realized results are converted at the rate of
 * the sale date (`toBaseAt`), open positions at today's rate (`toBaseNow`).
 */
export function performanceSummary<S extends SaleLike>(
  sales: S[],
  holdings: HoldingLike[],
  categories: Map<string, { name: string }>,
  toBaseAt: (amount: NumericInput, currency: string, date: string) => Decimal,
  toBaseNow: (amount: NumericInput, currency: string) => Decimal,
): PerformanceSummary<S> {
  const holdingById = new Map(holdings.map((h) => [h.id, h]))
  const cat = new Map<string, CategoryPerformance>()
  const catFor = (holdingId: string) => {
    const h = holdingById.get(holdingId)
    const id = h?.category_id && categories.has(h.category_id) ? h.category_id : 'none'
    let c = cat.get(id)
    if (!c) {
      c = { id, name: id === 'none' ? 'Uncategorised' : categories.get(id)!.name, realized: d(0), unrealized: d(0), value: d(0), trades: 0 }
      cat.set(id, c)
    }
    return c
  }

  let realized = d(0)
  let soldCost = d(0)
  let wins = 0
  let losses = 0
  let best: (S & { base: Decimal }) | null = null
  let worst: (S & { base: Decimal }) | null = null
  let daysSum = 0
  let daysCount = 0
  for (const s of sales) {
    const base = toBaseAt(s.realized, s.currency, s.date)
    realized = realized.plus(base)
    soldCost = soldCost.plus(toBaseAt(s.cost_basis, s.currency, s.date))
    if (d(s.realized).gt(0)) wins++
    else if (d(s.realized).lt(0)) losses++
    if (!best || base.gt(best.base)) best = { ...s, base }
    if (!worst || base.lt(worst.base)) worst = { ...s, base }
    const days = holdingDays(s)
    if (days !== null) {
      daysSum += days
      daysCount++
    }
    const c = catFor(s.holding_id)
    c.realized = c.realized.plus(base)
    c.trades++
  }

  let openValue = d(0)
  let openCost = d(0)
  for (const h of holdings) {
    if (!d(h.units).gt(0)) continue
    const p = openPosition(h)
    const value = toBaseNow(p.value, h.currency)
    const cost = toBaseNow(p.cost, h.currency)
    openValue = openValue.plus(value)
    openCost = openCost.plus(cost)
    const c = catFor(h.id)
    c.unrealized = c.unrealized.plus(value.minus(cost))
    c.value = c.value.plus(value)
  }
  const unrealized = openValue.minus(openCost)

  return {
    realized,
    soldCost,
    realizedPct: soldCost.isZero() ? null : realized.div(soldCost).times(100),
    unrealized,
    openValue,
    openCost,
    unrealizedPct: openCost.isZero() ? null : unrealized.div(openCost).times(100),
    trades: sales.length,
    wins,
    losses,
    winRate: sales.length ? (wins / sales.length) * 100 : null,
    best: sales.length ? best : null,
    worst: sales.length ? worst : null,
    avgHoldingDays: daysCount ? Math.round(daysSum / daysCount) : null,
    byCategory: [...cat.values()].sort((a, b) => b.realized.plus(b.unrealized).comparedTo(a.realized.plus(a.unrealized))),
  }
}

/** True when a price was entered or confirmed today (on this device's calendar). */
export function isPriceFresh(updatedAt: string | null | undefined, today: string = toIsoDate(new Date())): boolean {
  return !!updatedAt && toIsoDate(new Date(updatedAt)) === today
}
