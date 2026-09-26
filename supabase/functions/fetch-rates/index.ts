// Supabase Edge Function: fetch daily USD-based exchange rates into public.exchange_rates (global rows).
// Source: https://open.er-api.com (free, no key, updates daily; attribution required – see README).
// Schedule with pg_cron (see supabase/migrations/0002_cron.sql) or call manually:
//   curl -X POST https://<ref>.functions.supabase.co/fetch-rates -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Currencies always kept up to date, plus every currency any user has enabled.
const BASELINE = ['EGP', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'OMR', 'BHD', 'JOD', 'TRY', 'CAD', 'CHF', 'JPY', 'CNY']

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(SERVICE_ROLE) && !(await isCronCall(req))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  const { data: userCurrencies } = await supabase.from('currencies').select('code').eq('is_active', true)
  const wanted = new Set<string>([...BASELINE, ...(userCurrencies ?? []).map((c) => c.code)])
  wanted.delete('USD')

  const res = await fetch('https://open.er-api.com/v6/latest/USD')
  if (!res.ok) return new Response(JSON.stringify({ error: `provider ${res.status}` }), { status: 502 })
  const json = (await res.json()) as { result: string; rates: Record<string, number>; time_last_update_utc: string }
  if (json.result !== 'success') return new Response(JSON.stringify({ error: 'provider error' }), { status: 502 })

  const today = new Date().toISOString().slice(0, 10)
  const rows = [...wanted]
    .filter((c) => typeof json.rates[c] === 'number' && json.rates[c] > 0)
    .map((quote) => ({
      user_id: null,
      quote,
      rate: json.rates[quote].toFixed(8),
      rate_date: today,
      source: 'api',
      provider: 'open.er-api.com',
      fetched_at: new Date().toISOString(),
    }))

  const { error } = await supabase.from('exchange_rates').upsert(rows, { onConflict: 'user_id,quote,rate_date' })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  return new Response(JSON.stringify({ ok: true, count: rows.length, provider_time: json.time_last_update_utc }), { headers: { 'content-type': 'application/json' } })
})

/** pg_cron calls carry the service role key in the Authorization header via vault; nothing else is accepted. */
async function isCronCall(_req: Request): Promise<boolean> {
  return false
}
