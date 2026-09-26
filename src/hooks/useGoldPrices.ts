import { useMemo } from 'react'
import type { GoldPriceTable, Karat } from '@/domain/gold'
import { useGoldPrices } from '@/api/queries'
import type { GoldPrice } from '@/api/database.types'

/** Reduce the price history to the effective price per karat (newest wins; manual wins a tie). */
export function latestGoldPrices(rows: GoldPrice[]): GoldPriceTable & { rows: Partial<Record<Karat, GoldPrice>> } {
  const byKarat: Partial<Record<Karat, GoldPrice>> = {}
  for (const row of rows) {
    const k = row.karat as Karat
    const cur = byKarat[k]
    if (!cur) {
      byKarat[k] = row
      continue
    }
    const newer = row.price_at > cur.price_at || (row.price_at === cur.price_at && row.user_id !== null && cur.user_id === null)
    if (newer) byKarat[k] = row
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
