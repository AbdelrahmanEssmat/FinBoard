import { supabase } from '@/api/supabase'
import { newId } from '@/utils/ids'
import { MANUAL_GOLD_PRICE_HOURS } from '@/hooks/useGoldPrices'

/** Automatic gold prices are refreshed when the newest one is older than this. */
export const GOLD_REFRESH_MINUTES = 30

interface GoldApiResponse {
  ok: boolean
  prices?: Partial<Record<'24' | '22' | '21' | '18', number>>
  source?: 'local' | 'global'
  sourceName?: string
  fetchedAt?: string
  errors?: string[]
}

export type GoldRefreshResult =
  | { status: 'saved'; count: number; sourceName: string }
  | { status: 'fresh' }
  | { status: 'manual' }

/**
 * Fetch today's Egyptian gold prices from our own server function (/api/gold, which reads the
 * price sites) and save them as this user's price rows.
 *
 * - Skipped while prices are fresher than GOLD_REFRESH_MINUTES (unless forced).
 * - Skipped while a manual price is active: the manual price must win for its 24 hours, and a
 *   newer automatic row would otherwise replace it (the database treats the newest of the user's
 *   own rows in that window as the one to use).
 */
export async function refreshGoldPrices(userId: string | null, opts: { force?: boolean } = {}): Promise<GoldRefreshResult> {
  if (!userId) return { status: 'fresh' }
  const manualSince = new Date(Date.now() - MANUAL_GOLD_PRICE_HOURS * 3_600_000).toISOString()
  const { data: manual } = await supabase.from('gold_prices').select('id').eq('source', 'manual').gte('price_at', manualSince).limit(1)
  if (manual?.length) return { status: 'manual' }

  if (!opts.force) {
    const { data: latest } = await supabase.from('gold_prices').select('price_at').neq('source', 'manual').order('price_at', { ascending: false }).limit(1)
    const at = latest?.[0]?.price_at
    if (at && Date.now() - new Date(at).getTime() < GOLD_REFRESH_MINUTES * 60_000) return { status: 'fresh' }
  }

  const res = await fetch('/api/gold', { signal: AbortSignal.timeout(15000), cache: opts.force ? 'no-store' : 'default' })
  const json = (await res.json().catch(() => ({ ok: false }))) as GoldApiResponse
  if (!res.ok || !json.ok || !json.prices || !json.source) throw new Error(json.errors?.[0] ?? 'Gold price service unavailable')

  const priceAt = json.fetchedAt ?? new Date().toISOString()
  const rows = ([24, 22, 21, 18] as const)
    .filter((k) => typeof json.prices![String(k) as '24'] === 'number')
    .map((karat) => ({
      id: newId(),
      user_id: userId,
      karat,
      price_per_gram: json.prices![String(karat) as '24']!.toFixed(4),
      currency: 'EGP',
      source: json.source!,
      source_name: json.sourceName ?? null,
      price_at: priceAt,
    }))
  if (!rows.length) throw new Error('Gold price service returned no prices')
  const { error } = await supabase.from('gold_prices').insert(rows)
  if (error) throw error

  // keep the history light: automatic rows older than two weeks are no longer needed (each day's
  // net worth snapshot already stored its value); manual prices are kept
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
  void supabase.from('gold_prices').delete().eq('user_id', userId).neq('source', 'manual').lt('price_at', cutoff).then(() => undefined)

  return { status: 'saved', count: rows.length, sourceName: json.sourceName ?? '' }
}
