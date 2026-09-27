/**
 * Egyptian gold prices (EGP per gram by karat), read from public web pages. Shared by the server
 * function (api/gold.ts) and the tests; no imports, so it bundles anywhere.
 *
 * Sources, in order:
 *   1. banklive.net: Egyptian market; prices in <option value="7131.00">Gold 24 Karat</option>
 *      (or JSON-LD text "The current price of gold is 6240.00 for 21 karats.")
 *   2. gold-price-today.com/egypt: Egyptian market; HTML table "عيار 24 … font-bold …>7,130<"
 *   3. dahabpulse.com: global spot per gram in USD × USD→EGP (a fallback, labelled "global")
 *
 * Page scraping is fragile, so every result must pass sanePrices() before it is used.
 */

export type GoldKarat = 24 | 22 | 21 | 18
export type GoldPrices = Partial<Record<GoldKarat, number>>
export interface GoldQuote {
  prices: GoldPrices
  source: 'local' | 'global'
  sourceName: string
}

const num = (s: string) => Number(s.replace(/[,\s]/g, ''))

/** 24K, 21K and 18K present, in a believable EGP range, in the right order, 21K ≈ 87.5% of 24K. */
export function sanePrices(p: GoldPrices): boolean {
  const k24 = p[24], k21 = p[21], k18 = p[18]
  if (!k24 || !k21 || !k18) return false
  if (![k24, k21, k18].every((v) => Number.isFinite(v))) return false
  if (k24 < 500 || k24 > 200_000) return false
  if (!(k24 > k21 && k21 > k18)) return false
  const ratio = k21 / k24
  return ratio > 0.8 && ratio < 0.93
}

export function parseBankLive(html: string): GoldPrices {
  const prices: GoldPrices = {}
  for (const m of html.matchAll(/<option value="([\d.,]+)">\s*Gold (24|22|21|18) Karat\s*<\/option>/g)) prices[Number(m[2]) as GoldKarat] = num(m[1]!)
  if (!prices[24]) {
    for (const m of html.matchAll(/price of gold is ([\d.,]+) for (24|22|21|18) karats/g)) prices[Number(m[2]) as GoldKarat] = num(m[1]!)
  }
  return prices
}

export function parseGoldPriceToday(html: string): GoldPrices {
  const prices: GoldPrices = {}
  for (const k of [24, 22, 21, 18] as GoldKarat[]) {
    const m = html.match(new RegExp(`عيار\\s*${k}<\\/span>[\\s\\S]{0,600}?font-bold[^>]*>\\s*([\\d,]+)\\s*<`))
    if (m) prices[k] = num(m[1]!)
  }
  return prices
}

export function pricesFromGlobalSpot(json: { perGramUsd?: Record<string, number>; currencies?: Record<string, number> }): GoldPrices {
  const egp = json.currencies?.EGP
  const g = json.perGramUsd
  if (!egp || !g) return {}
  const at = (k: string) => (typeof g[k] === 'number' ? Math.round(g[k]! * egp * 100) / 100 : undefined)
  return { 24: at('24k'), 22: at('22k'), 21: at('21k'), 18: at('18k') }
}
