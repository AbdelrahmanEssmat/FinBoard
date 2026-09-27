import { supabase } from '@/api/supabase'
import { newId } from '@/utils/ids'
import { todayIso } from '@/domain/format'

interface ErApiResponse {
  result: string
  time_last_update_utc: string
  rates: Record<string, number>
}

/** Automatic rates are re-checked when today's were fetched longer ago than this. */
export const RATES_REFRESH_HOURS = 6

/**
 * Fetch exchange rates (open.er-api.com, free, published once a day) into this user's rate rows
 * for today. Runs when today's rates are missing, when they were fetched more than
 * RATES_REFRESH_HOURS ago (the provider may have published a newer set since), or when forced.
 * Existing rows for today are updated in place; manual rates are never touched.
 * Returns the number of rates written (0 when nothing needed doing).
 */
export async function refreshRatesFromClient(codes: string[], userId: string | null, opts: { force?: boolean } = {}): Promise<number> {
  if (!userId) return 0
  const today = todayIso()
  const wanted = codes.filter((c) => c !== 'USD')
  if (!wanted.length) return 0
  const { data: todays } = await supabase.from('exchange_rates').select('id,quote,user_id,fetched_at,source').eq('rate_date', today)
  // a rate the user set by hand today wins until tomorrow: never overwrite it (it shares the one
  // row per user, currency and day with the automatic rate)
  const manual = new Set((todays ?? []).filter((r) => r.source === 'manual' && r.user_id === userId).map((r) => r.quote))
  const existing = (todays ?? []).filter((r) => r.source === 'api')
  const mine = new Map(existing.filter((r) => r.user_id === userId).map((r) => [r.quote, r]))
  const have = new Set([...existing.map((r) => r.quote), ...manual])
  const missing = wanted.filter((c) => !have.has(c))
  const oldest = Math.min(...existing.map((r) => (r.fetched_at ? new Date(r.fetched_at).getTime() : 0)), Date.now())
  const stale = Date.now() - oldest > RATES_REFRESH_HOURS * 3_600_000
  if (!opts.force && !missing.length && !stale) return 0

  const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(12000), cache: 'no-store' })
  if (!res.ok) throw new Error('Rate service unavailable')
  const json = (await res.json()) as ErApiResponse
  if (json.result !== 'success') throw new Error('Rate service returned an error')
  const fetchedAt = new Date().toISOString()
  const rows = wanted
    .filter((c) => !manual.has(c) && typeof json.rates[c] === 'number' && json.rates[c]! > 0)
    .map((c) => ({ id: mine.get(c)?.id ?? newId(), user_id: userId, quote: c, rate: json.rates[c]!.toFixed(8), rate_date: today, source: 'api' as const, provider: 'open.er-api.com', fetched_at: fetchedAt }))
  if (!rows.length) return 0
  // update today's automatic rows in place (one row per user, currency and day)
  const { error } = await supabase.from('exchange_rates').upsert(rows, { onConflict: 'user_id,quote,rate_date' })
  if (error) throw error
  return rows.length
}
