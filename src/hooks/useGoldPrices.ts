import { useMemo } from 'react'
import type { GoldPriceTable, Karat } from '@/domain/gold'
import { useGoldPrices } from '@/api/queries'
import type { GoldPrice } from '@/api/database.types'

/** How long a manual price overrides the automatic ones (same rule as public.gold_price_per_gram). */
export const MANUAL_GOLD_PRICE_HOURS = 24

/**
 * Reduce the price history to the effective price per karat. A manual price set within the last
 * 24 hours wins; otherwise the newest price wins (a manual one wins an exact tie).
 */
export function latestGoldPrices(rows: GoldPrice[], now = Date.now()): GoldPriceTable & { rows: Partial<Record<Karat, GoldPrice>> } {
  const manualActive = (r: GoldPrice) => r.user_id !== null && now - new Date(r.price_at).getTime() < MANUAL_GOLD_PRICE_HOURS * 3_600_000
  const beats = (a: GoldPrice, b: GoldPrice) => {
    if (manualActive(a) !== manualActive(b)) return manualActive(a)
    if (a.price_at !== b.price_at) return new Date(a.price_at).getTime() > new Date(b.price_at).getTime()
    return a.user_id !== null && b.user_id === null
  }
  const byKarat: Partial<Record<Karat, GoldPrice>> = {}
  for (const row of rows) {
    const k = row.karat as Karat
    const cur = byKarat[k]
    if (!cur || beats(row, cur)) byKarat[k] = row
  }
  const ref = byKarat[21] ?? byKarat[24] ?? byKarat[18]
  const perGram: Partial<Record<Karat, number>> = {}
  for (const k of [24, 22, 21, 18] as Karat[]) if (byKarat[k]) perGram[k] = byKarat[k]!.price_per_gram
  return { perGram, source: ref?.source ?? 'none', sourceName: ref?.source_name ?? null, priceAt: ref?.price_at ?? null, rows: byKarat }
}

export function useGoldPriceTable() {
  const { data } = useGoldPrices()
  return useMemo(() => latestGoldPrices(data ?? []), [data])
}
