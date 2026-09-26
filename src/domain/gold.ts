import { d, Decimal, type NumericInput } from '@/domain/money'

export type Karat = 24 | 22 | 21 | 18
export const KARATS: Karat[] = [24, 22, 21, 18]
export const KARAT_PURITY: Record<Karat, number> = { 24: 1, 22: 22 / 24, 21: 21 / 24, 18: 18 / 24 }

export const TROY_OUNCE_GRAMS = new Decimal('31.1034768')

export interface GoldPriceTable {
  /** EGP per gram, by karat */
  perGram: Partial<Record<Karat, NumericInput>>
  source: 'local' | 'global' | 'manual' | 'none'
  sourceName?: string | null
  priceAt?: string | null
}

export interface GoldItemLike {
  karat: Karat | number
  weight_grams: NumericInput
  purchase_price: NumericInput
  /** currency of purchase_price and workmanship_cost; EGP when omitted */
  purchase_currency?: string
  workmanship_cost?: NumericInput
}

/** Derive per-karat EGP prices from the global spot price (USD/oz) and USD→EGP. */
export function pricesFromSpot(usdPerOunce: NumericInput, usdToEgp: NumericInput): Record<Karat, Decimal> {
  const perGram24 = d(usdPerOunce).div(TROY_OUNCE_GRAMS).times(d(usdToEgp))
  return {
    24: perGram24,
    22: perGram24.times(22).div(24),
    21: perGram24.times(21).div(24),
    18: perGram24.times(18).div(24),
  }
}

export function goldItemValue(item: GoldItemLike, prices: GoldPriceTable): Decimal | null {
  const price = prices.perGram[item.karat as Karat]
  if (price === undefined || price === null) return null
  return d(item.weight_grams).times(d(price))
}

export function goldItemCost(item: GoldItemLike): Decimal {
  return d(item.purchase_price).plus(d(item.workmanship_cost))
}

export interface GoldSummary {
  grams: Decimal
  value: Decimal
  cost: Decimal
  gain: Decimal
  gainPercent: Decimal | null
  missingPrice: boolean
}

/**
 * Totals in EGP (gold prices are EGP per gram). Purchase costs in other currencies are converted
 * with `toEgp`; without a converter only EGP costs can be summed correctly.
 */
export function goldSummary(items: GoldItemLike[], prices: GoldPriceTable, toEgp: (amount: Decimal, currency: string) => Decimal = (a) => a): GoldSummary {
  let grams = new Decimal(0)
  let value = new Decimal(0)
  let cost = new Decimal(0)
  let missingPrice = false
  for (const it of items) {
    grams = grams.plus(d(it.weight_grams))
    const v = goldItemValue(it, prices)
    if (v === null) missingPrice = true
    else value = value.plus(v)
    cost = cost.plus(toEgp(goldItemCost(it), it.purchase_currency ?? 'EGP'))
  }
  const gain = value.minus(cost)
  return { grams, value, cost, gain, gainPercent: cost.isZero() ? null : gain.div(cost).times(100), missingPrice }
}
