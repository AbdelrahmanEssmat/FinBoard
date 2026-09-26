// Supabase Edge Function: Egyptian local gold prices (EGP per gram by karat) into public.gold_prices (global rows).
//
// Order of sources:
//   1. banklive.net  – Egyptian market prices; exposes the numbers in JSON-LD and <option value="7131.00">Gold 24 Karat</option>
//   2. gold-price-today.com/egypt – Egyptian market prices ("سعر الذهب في محلات الصاغة"); JSON-LD FinancialQuote + HTML table
//   3. Fallback: global spot via dahabpulse.com/api/widget-prices (per-karat USD/gram × USD→EGP), labelled source='global'
//
// Scraping is inherently fragile; each parser validates that prices are in a sane range and that 21K < 24K.
// Schedule every 30–60 minutes with pg_cron (see supabase/migrations/0002_cron.sql).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'

type Karat = 24 | 22 | 21 | 18
interface Quote {
  prices: Partial<Record<Karat, number>>
  source: 'local' | 'global'
  sourceName: string
}

function sane(p: Partial<Record<Karat, number>>): boolean {
  const k24 = p[24], k21 = p[21], k18 = p[18]
  if (!k24 || !k21 || !k18) return false
  if (k24 < 500 || k24 > 200000) return false
  if (!(k24 > k21 && k21 > k18)) return false
  // 21K should be ~87.5% of 24K (allow dealer spread)
  const ratio = k21 / k24
  return ratio > 0.8 && ratio < 0.93
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en,ar' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return await res.text()
}

const num = (s: string) => Number(s.replace(/[,\s]/g, ''))

async function fromBankLive(): Promise<Quote> {
  const html = await getText('https://banklive.net/en/gold-price-today-in-egypt')
  const prices: Partial<Record<Karat, number>> = {}
  // <option value="7131.00">Gold 24 Karat</option>
  for (const m of html.matchAll(/<option value="([\d.]+)">\s*Gold (24|22|21|18) Karat\s*<\/option>/g)) prices[Number(m[2]) as Karat] = num(m[1])
  if (!prices[24]) {
    // JSON-LD text: "The current price of gold is 6240.00 for 21 karats."
    for (const m of html.matchAll(/price of gold is ([\d.,]+) for (24|22|21|18) karats/g)) prices[Number(m[2]) as Karat] = num(m[1])
  }
  if (!sane(prices)) throw new Error('banklive: parse failed ' + JSON.stringify(prices))
  return { prices, source: 'local', sourceName: 'banklive.net' }
}

async function fromGoldPriceToday(): Promise<Quote> {
  const html = await getText('https://www.gold-price-today.com/egypt/')
  const prices: Partial<Record<Karat, number>> = {}
  // Table rows: <span ...>عيار 24</span> ... <span class="text-lg ... font-bold ...">7,130 <span
  for (const k of [24, 22, 21, 18] as Karat[]) {
    const re = new RegExp(`عيار\\s*${k}<\\/span>[\\s\\S]{0,600}?font-bold[^>]*>\\s*([\\d,]+)\\s*<`)
    const m = html.match(re)
    if (m) prices[k] = num(m[1])
  }
  if (!sane(prices)) throw new Error('gold-price-today: parse failed ' + JSON.stringify(prices))
  return { prices, source: 'local', sourceName: 'gold-price-today.com' }
}

async function fromGlobalSpot(): Promise<Quote> {
  const res = await fetch('https://dahabpulse.com/api/widget-prices', { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error('dahabpulse ' + res.status)
  const j = (await res.json()) as { perGramUsd: Record<string, number>; currencies: Record<string, number> }
  const egp = j.currencies?.EGP
  if (!egp) throw new Error('dahabpulse: no EGP rate')
  const prices: Partial<Record<Karat, number>> = {
    24: j.perGramUsd['24k'] * egp,
    22: j.perGramUsd['22k'] * egp,
    21: j.perGramUsd['21k'] * egp,
    18: j.perGramUsd['18k'] * egp,
  }
  if (!sane(prices)) throw new Error('dahabpulse: insane ' + JSON.stringify(prices))
  return { prices, source: 'global', sourceName: 'Global spot (dahabpulse.com) × USD/EGP' }
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(SERVICE_ROLE)) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })

  const errors: string[] = []
  let quote: Quote | null = null
  for (const fn of [fromBankLive, fromGoldPriceToday, fromGlobalSpot]) {
    try {
      quote = await fn()
      break
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (!quote) return new Response(JSON.stringify({ error: 'all sources failed', errors }), { status: 502 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)
  const now = new Date().toISOString()
  const rows = ([24, 22, 21, 18] as Karat[])
    .filter((k) => quote!.prices[k])
    .map((karat) => ({
      user_id: null,
      karat,
      price_per_gram: quote!.prices[karat]!.toFixed(4),
      currency: 'EGP',
      source: quote!.source,
      source_name: quote!.sourceName,
      price_at: now,
    }))
  const { error } = await supabase.from('gold_prices').insert(rows)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  // keep the table small: one row per karat per hour older than 7 days is plenty
  await supabase.rpc('prune_gold_prices').then(() => undefined, () => undefined)

  return new Response(JSON.stringify({ ok: true, source: quote.sourceName, prices: quote.prices, errors }), { headers: { 'content-type': 'application/json' } })
})
