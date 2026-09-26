import { supabase } from '@/api/supabase'
import { newId } from '@/utils/ids'
import { todayIso } from '@/domain/format'

interface ErApiResponse {
  result: string
  time_last_update_utc: string
  rates: Record<string, number>
}

/**
 * Client-side fallback for fetching rates (the scheduled edge function is the primary path).
 * Writes rows owned by the user with source 'api' so RLS allows them.
 * Returns the number of rows written (0 when today's rates already exist).
 */
export async function refreshRatesFromClient(codes: string[], userId: string | null): Promise<number> {
  if (!userId) return 0
  const today = todayIso()
  const wanted = codes.filter((c) => c !== 'USD')
  if (!wanted.length) return 0
  const { data: existing } = await supabase.from('exchange_rates').select('quote,user_id').eq('rate_date', today).eq('source', 'api')
  const have = new Set((existing ?? []).map((r) => r.quote))
  const missing = wanted.filter((c) => !have.has(c))
  if (!missing.length) return 0

  const res = await fetch('https://open.er-api.com/v6/latest/USD')
  if (!res.ok) throw new Error('Rate service unavailable')
  const json = (await res.json()) as ErApiResponse
  if (json.result !== 'success') throw new Error('Rate service returned an error')
  const rows = missing
    .filter((c) => typeof json.rates[c] === 'number')
    .map((c) => ({ id: newId(), user_id: userId, quote: c, rate: json.rates[c]!.toFixed(8), rate_date: today, source: 'api' as const, provider: 'open.er-api.com', fetched_at: new Date().toISOString() }))
  if (!rows.length) return 0
  const { error } = await supabase.from('exchange_rates').upsert(rows, { onConflict: 'user_id,quote,rate_date', ignoreDuplicates: true })
  if (error) throw error
  return rows.length
}
