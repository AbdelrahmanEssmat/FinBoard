/**
 * Vercel function: GET /api/gold → today's Egyptian gold prices (EGP per gram by karat).
 *
 * Browsers can't read the price sites directly (they don't allow cross-site requests), so the app
 * asks this function, which reads them server-side. Responses are cached at Vercel's edge for 10
 * minutes, so many devices opening the app don't hit the sites more than a few times an hour.
 *
 * Response: { ok: true, prices: {24,22,21,18}, source: 'local'|'global', sourceName, fetchedAt, errors }
 *       or  { ok: false, errors } with status 502 when every source failed.
 */
import { parseBankLive, parseGoldPriceToday, pricesFromGlobalSpot, sanePrices, type GoldQuote } from '../src/domain/goldSources.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en,ar' }, signal: AbortSignal.timeout(7000) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return await res.text()
}

const SOURCES: { name: string; load: () => Promise<GoldQuote> }[] = [
  {
    name: 'banklive.net',
    load: async () => ({ prices: parseBankLive(await getText('https://banklive.net/en/gold-price-today-in-egypt')), source: 'local', sourceName: 'banklive.net' }),
  },
  {
    name: 'gold-price-today.com',
    load: async () => ({ prices: parseGoldPriceToday(await getText('https://www.gold-price-today.com/egypt/')), source: 'local', sourceName: 'gold-price-today.com' }),
  },
  {
    name: 'dahabpulse.com',
    load: async () => {
      const res = await fetch('https://dahabpulse.com/api/widget-prices', { signal: AbortSignal.timeout(7000) })
      if (!res.ok) throw new Error(`dahabpulse.com answered ${res.status}`)
      const json = (await res.json()) as Parameters<typeof pricesFromGlobalSpot>[0]
      return { prices: pricesFromGlobalSpot(json), source: 'global', sourceName: 'Global spot × USD/EGP' }
    },
  },
]

export async function GET(): Promise<Response> {
  const errors: string[] = []
  for (const s of SOURCES) {
    try {
      const quote = await s.load()
      if (!sanePrices(quote.prices)) throw new Error(`${s.name}: prices didn't look right ${JSON.stringify(quote.prices)}`)
      return Response.json(
        { ok: true, ...quote, fetchedAt: new Date().toISOString(), errors },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=1200' } },
      )
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return Response.json({ ok: false, errors }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
}
