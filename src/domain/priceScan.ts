/**
 * Reading prices off a screenshot of a broker app. The OCR (src/ocr) hands over words with their
 * boxes; this file is the pure logic: group the words into entries, pick the ticker or name and the
 * main number of each, match it to one of the open holdings, and work out whether the number is a
 * price per unit or the position's total value (Thndr shows totals, other apps show prices). Every
 * decision comes with a confidence and a plain-English reason, so the review screen can leave the
 * doubtful ones unticked.
 */
import { d, Decimal, parseAmount, type NumericInput } from '@/domain/money'

export interface ScanWord {
  text: string
  /** 0–100, from the OCR */
  confidence: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ScanHolding {
  id: string
  name: string
  ticker: string | null
  units: NumericInput
  current_price: NumericInput
}

export type ScanKind = 'unit' | 'total'
export type ScanConfidence = 'high' | 'medium' | 'low'

/** One entry read off the screenshot: a label and its main number. */
export interface ScanRow {
  label: string
  /** the number as it was read */
  raw: string
  value: Decimal
  /** other readings of the same text (14.800 could be 14,800) */
  alts: Decimal[]
  /** vertical position, to keep the screenshot's order */
  y: number
  /** OCR confidence of the label and number, 0–100 */
  ocr: number
  /** the day's change beside the number (+1,359 ▲ 10.11%), when the screenshot shows one */
  change?: { amount: Decimal; pct: Decimal }
}

export interface ScanMatch extends ScanRow {
  holdingId: string
  kind: ScanKind
  /** the new price per unit */
  price: Decimal
  /** the number could be read either way */
  ambiguous: boolean
  confidence: ScanConfidence
  reason: string
}

export interface ScanResult {
  matches: ScanMatch[]
  /** entries that fit none of the holdings */
  unmatched: ScanRow[]
  /** open holdings the screenshot didn't mention (their ids) */
  notFound: string[]
}

// ---------- numbers ----------

const SIGNS = /^[+\-−–—]+/
const ARROWS = /[▲▼△▽↑↓]/
const CURRENCY = /^(?:EGP|E£|LE|USD|\$|£|€)\s*/i
const CONFUSIONS: Record<string, string> = { O: '0', o: '0', l: '1', I: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2' }

export interface ReadNumber {
  value: Decimal
  alts: Decimal[]
  /** came with a + or − (a change, not a price) */
  signed: boolean
  /** the sign was a minus (or a down arrow) */
  negative: boolean
  percent: boolean
}

/**
 * A number as the OCR read it: signs, arrows, currency and % are stripped and remembered, and letters
 * the OCR often mistakes for digits (O, l, S, B) are fixed when that makes the whole token a number.
 */
export function readNumber(text: string): ReadNumber | null {
  let s = text.trim()
  const signed = SIGNS.test(s) || ARROWS.test(s)
  const negative = /^[-−–—▼▽↓]/.test(s)
  s = s.replace(SIGNS, '').replace(ARROWS, '').trim().replace(CURRENCY, '').replace(/\s*(?:EGP|LE)$/i, '')
  const percent = /%$/.test(s)
  s = s.replace(/%$/, '').replace(/[.,]$/, '')
  if (!/\d/.test(s)) return null
  const fixed = s.replace(/[OolI|SsBZ]/g, (c) => CONFUSIONS[c] ?? c)
  if (/^[\d.,]+$/.test(fixed)) s = fixed
  const value = parseAmount(s)
  if (!value) return null
  const alts: Decimal[] = []
  // a dot or comma followed by exactly three digits: thousands or decimals, the holding will tell
  if (/^\d{1,3}\.\d{3}$/.test(s)) alts.push(d(s.replace('.', '')))
  if (/^\d{1,3},\d{3}$/.test(s) && !/,000$/.test(s)) alts.push(d(s.replace(',', '.')))
  return { value, alts, signed, negative, percent }
}

// ---------- rows ----------

const STOP_WORDS = new Set(['stocks', 'stock', 'funds', 'fund', 'net', 'worth', 'total', 'value', 'cash', 'egp', 'change', 'today', 'portfolio', 'holdings', 'holding', 'price', 'units', 'unit', 'shares', 'market', 'gain', 'loss', 'profit', 'balance', 'invested', 'assets', 'equity', 'qty', 'quantity', 'avg', 'cost'])
const UNIT_WORDS = /^(?:units?|shares?|sh|qty)$/i
const isLabelWord = (t: string) => /^[A-Za-z][A-Za-z&'.-]*[A-Za-z.]?$/.test(t) && t.replace(/[^A-Za-z]/g, '').length >= 2 && !STOP_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, ''))
const isMarker = (t: string) => /^[+\-−–—▲▼△▽↑↓%]+$/.test(t)

const height = (w: { y0: number; y1: number }) => w.y1 - w.y0
const centre = (w: { y0: number; y1: number }) => (w.y0 + w.y1) / 2

/** Words on the same line: sorted by their vertical centre, joined while they overlap the line. */
export function groupLines(words: ScanWord[]): ScanWord[][] {
  const sorted = words.filter((w) => w.text.trim() && height(w) > 0).sort((a, b) => centre(a) - centre(b))
  const lines: { y0: number; y1: number; words: ScanWord[] }[] = []
  for (const w of sorted) {
    const line = lines[lines.length - 1]
    if (line) {
      const overlap = Math.min(line.y1, w.y1) - Math.max(line.y0, w.y0)
      const c = centre(w)
      if ((c >= line.y0 && c <= line.y1) || overlap >= 0.4 * Math.min(height(w), line.y1 - line.y0)) {
        line.words.push(w)
        line.y0 = Math.min(line.y0, w.y0)
        line.y1 = Math.max(line.y1, w.y1)
        continue
      }
    }
    lines.push({ y0: w.y0, y1: w.y1, words: [w] })
  }
  return lines.map((l) => l.words.sort((a, b) => a.x0 - b.x0))
}

interface Num {
  word: ScanWord
  n: ReadNumber
  change: boolean
}
interface Line {
  y0: number
  y1: number
  labels: ScanWord[]
  nums: Num[]
}

function readLine(words: ScanWord[]): Line {
  const labels: ScanWord[] = []
  const nums: Num[] = []
  words.forEach((w, i) => {
    const t = w.text.trim()
    const prev = words[i - 1]?.text.trim() ?? ''
    const next = words[i + 1]?.text.trim() ?? ''
    const n = readNumber(t)
    if (n) {
      // a change: signed, a percentage, next to an arrow or sign, or a count of units
      const change = n.signed || n.percent || isMarker(prev) || isMarker(next) || /%/.test(next) || UNIT_WORDS.test(next) || prev === '%'
      nums.push({ word: w, n, change })
    } else if (isLabelWord(t)) labels.push(w)
  })
  return { y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)), labels, nums }
}

/**
 * Entries: a label line (ticker or name) with the numbers on it and on the number-only lines right
 * above or below it (Thndr puts the value and its daily change in a two-line cell beside the ticker).
 * A name-only line glued to the ticker line lends it its words.
 */
export function readRows(words: ScanWord[]): ScanRow[] {
  const lines = groupLines(words).map(readLine)
  const labelLines = lines.filter((l) => l.labels.length)
  const extra = new Map<Line, Num[]>()
  for (const l of lines) {
    if (l.labels.length || !l.nums.length) continue
    const c = centre(l)
    let best: Line | null = null
    let bestDist = Infinity
    for (const t of labelLines) {
      const dist = Math.abs(centre(t) - c)
      if (dist < bestDist) {
        best = t
        bestDist = dist
      }
    }
    if (best && bestDist <= 1.6 * Math.max(height(best), height(l))) extra.set(best, [...(extra.get(best) ?? []), ...l.nums])
  }
  const rows: ScanRow[] = []
  const borrowed = new Set<Line>()
  for (const [i, l] of labelLines.entries()) {
    if (borrowed.has(l)) continue
    let labels = l.labels
    const nums = [...l.nums, ...(extra.get(l) ?? [])]
    if (!nums.length) continue
    // a label-only line touching this one (the company name above its ticker) adds its words
    for (const nb of [labelLines[i - 1], labelLines[i + 1]]) {
      if (!nb || nb.nums.length || extra.has(nb) || borrowed.has(nb)) continue
      const gap = nb.y0 < l.y0 ? l.y0 - nb.y1 : nb.y0 - l.y1
      if (gap <= 0.5 * Math.min(height(nb), height(l))) {
        labels = nb.y0 < l.y0 ? [...nb.labels, ...labels] : [...labels, ...nb.labels]
        borrowed.add(nb)
      }
    }
    const candidates = nums.filter((x) => !x.change && !x.n.value.isZero())
    if (!candidates.length) continue
    // the main number is the rightmost one; the holding may still prefer another (see scanPrices)
    const main = candidates.reduce((a, b) => (b.word.x1 > a.word.x1 ? b : a))
    const ocr = Math.min(...labels.map((w) => w.confidence), main.word.confidence)
    // the day's change: an amount with a sign and a percentage, which together pin the main number down
    const amount = nums.find((x) => x.change && x.n.signed && !x.n.percent)
    const pct = nums.find((x) => x.n.percent && !x.n.value.isZero())
    rows.push({
      label: labels.map((w) => w.text.trim()).join(' '),
      raw: main.word.text.trim(),
      value: main.n.value,
      alts: [...main.n.alts, ...candidates.filter((x) => x !== main).map((x) => x.n.value)],
      y: centre(l),
      ocr,
      ...(amount && pct ? { change: { amount: amount.n.negative ? amount.n.value.neg() : amount.n.value, pct: pct.n.value } } : {}),
    })
  }
  return rows.sort((a, b) => a.y - b.y)
}

// ---------- matching ----------

const CANON: Record<string, string> = { '0': 'O', '1': 'I', L: 'I', '5': 'S', '8': 'B', '2': 'Z' }
const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[0158L2]/g, (c) => CANON[c] ?? c)
const normName = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_WORDS.has(t))
    .join(' ')

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length || !b.length) return Math.max(a.length, b.length)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]!
}

const similarity = (a: string, b: string) => (a.length && b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0)

export interface HoldingMatch {
  holding: ScanHolding
  tier: 'ticker' | 'ticker-fuzzy' | 'name'
  score: number
}

function scoreHolding(label: string, h: ScanHolding): HoldingMatch | null {
  const tokens = label.split(/\s+/).filter(Boolean)
  const ticker = h.ticker?.trim().toUpperCase()
  if (ticker) {
    if (tokens.some((t) => t.toUpperCase() === ticker)) return { holding: h, tier: 'ticker', score: 1 }
    const c = canon(ticker)
    for (const t of tokens) {
      const ct = canon(t)
      if (ct.length < 2) continue
      if (ct === c) return { holding: h, tier: 'ticker-fuzzy', score: 0.9 }
      if (ticker.length >= 4 && levenshtein(ct, c) <= 1) return { holding: h, tier: 'ticker-fuzzy', score: 0.85 }
    }
  }
  const name = normName(h.name)
  if (!name) return null
  const whole = normName(label)
  let sim = 0
  const consider = (s: string) => {
    if (s.length < 3) return
    if (name === s) sim = Math.max(sim, 1)
    else if (name.includes(s) || s.includes(name)) sim = Math.max(sim, 0.75 + (0.25 * Math.min(name.length, s.length)) / Math.max(name.length, s.length))
    else {
      const r = similarity(name, s)
      if (r >= 0.75) sim = Math.max(sim, r)
    }
  }
  consider(whole)
  const nameWords = name.split(' ')
  // the name's initials, for a fund shown by a code the holding doesn't have as its ticker (BWA = Beltone Wealth Allocation)
  const initials = nameWords.map((x) => x[0]).join('')
  for (const t of whole.split(' ')) {
    if (t.length >= 2 && nameWords.length >= 2 && t === initials) sim = Math.max(sim, 0.9)
    if (t.length < 3) continue
    // one word of the name on its own is a hint, not a match (both Beltone funds share it)
    if (nameWords.includes(t)) sim = Math.max(sim, 0.7)
    else consider(t)
  }
  return sim ? { holding: h, tier: 'name', score: 0.8 * sim } : null
}

/** The one holding a label points at, or null when none fits or two fit about as well. */
export function matchHolding(label: string, holdings: ScanHolding[]): HoldingMatch | null {
  const scored = holdings.map((h) => scoreHolding(label, h)).filter((m): m is HoldingMatch => !!m).sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score < 0.6) return null
  const next = scored.find((m) => m.holding.id !== best.holding.id)
  if (next && best.score - next.score < 0.1) return null
  return best
}

// ---------- per unit or total ----------

export interface Interpretation {
  kind: ScanKind
  price: Decimal
  ambiguous: boolean
  /** how the number sat against the last price: it fit one reading, both, or neither */
  fit: 'one' | 'both' | 'none'
}

const BAND = [0.5, 1.5] as const
const inBand = (r: number) => r >= BAND[0] && r <= BAND[1]
const closeness = (r: number) => Math.abs(Math.log(r))

/**
 * Is the number a price per unit or the whole position? Compared with the last known price and
 * value: the reading within half and one-and-a-half times what it was wins; both (or neither) leaves it ambiguous.
 */
export function interpret(value: Decimal, h: ScanHolding, force?: ScanKind): Interpretation {
  const units = d(h.units)
  const price = d(h.current_price)
  const asPrice = (kind: ScanKind) => (kind === 'unit' || units.lte(0) ? value : value.div(units)).toDecimalPlaces(6)
  if (force) {
    const r = price.gt(0) ? asPrice(force).div(price).toNumber() : 0
    return { kind: force, price: asPrice(force), ambiguous: false, fit: inBand(r) ? 'one' : 'none' }
  }
  if (units.lte(1)) {
    const r = price.gt(0) ? value.div(price).toNumber() : 0
    return { kind: 'unit', price: asPrice('unit'), ambiguous: false, fit: inBand(r) ? 'one' : 'none' }
  }
  if (!price.gt(0)) return { kind: 'total', price: asPrice('total'), ambiguous: true, fit: 'none' }
  const rU = value.div(price).toNumber()
  const rT = value.div(units.times(price)).toNumber()
  const u = inBand(rU)
  const t = inBand(rT)
  if (u && !t) return { kind: 'unit', price: asPrice('unit'), ambiguous: false, fit: 'one' }
  if (t && !u) return { kind: 'total', price: asPrice('total'), ambiguous: false, fit: 'one' }
  if (u && t) {
    const kind: ScanKind = closeness(rU) <= closeness(rT) ? 'unit' : 'total'
    return { kind, price: asPrice(kind), ambiguous: true, fit: 'both' }
  }
  return { kind: 'total', price: asPrice('total'), ambiguous: true, fit: 'none' }
}

/** How far a reading is from the last price, 0 = spot on (Infinity when there is no last price). */
function distance(value: Decimal, h: ScanHolding): number {
  const price = d(h.current_price)
  if (!price.gt(0)) return Infinity
  const i = interpret(value, h)
  return closeness(i.price.div(price).toNumber())
}

/** The value a day's change implies: the amount is pct% of the value before it, so now = before + amount. */
export function impliedValue(change: { amount: Decimal; pct: Decimal } | undefined): Decimal | null {
  if (!change || change.pct.lte(0) || change.amount.isZero()) return null
  const before = change.amount.abs().div(change.pct).times(100)
  const now = before.plus(change.amount)
  return now.gt(0) ? now : null
}

// ---------- the whole thing ----------

const RANK: Record<ScanConfidence, number> = { high: 3, medium: 2, low: 1 }

export function scanPrices(words: ScanWord[], holdings: ScanHolding[]): ScanResult {
  const rows = readRows(words)
  const matches: ScanMatch[] = []
  const unmatched: ScanRow[] = []
  for (const row of rows) {
    const m = matchHolding(row.label, holdings)
    if (!m) {
      // worth showing only when it looks like a real entry, not the clock, battery or a logo
      if (row.ocr >= 50 && row.value.gte(10) && row.label.replace(/[^A-Za-z]/g, '').length >= 3) unmatched.push(row)
      continue
    }
    const h = m.holding
    // the day's change says what the number must be: +1,359 and 10.11% mean 13,441 before, 14,800 now.
    // Whichever reading agrees with that is taken (14.800 → 14,800), whatever the last price says
    let value = row.value
    let reread = false
    let checked = false
    const implied = impliedValue(row.change)
    if (implied) {
      const agrees = (v: Decimal) => v.minus(implied).abs().div(implied).lte(0.02)
      if (agrees(value)) checked = true
      else {
        const alt = row.alts.find(agrees)
        if (alt) {
          value = alt
          reread = true
          checked = true
        }
      }
    }
    if (!checked && interpret(value, h).fit === 'none') {
      let dist = Infinity
      for (const alt of row.alts) {
        const altDist = distance(alt, h)
        if (interpret(alt, h).fit === 'one' && altDist < dist) {
          value = alt
          dist = altDist
          reread = true
        }
      }
    }
    const it = interpret(value, h)
    const last = d(h.current_price)
    const move = last.gt(0) ? it.price.minus(last).div(last).abs().times(100).toNumber() : Infinity
    const units = d(h.units)
    const reasons: string[] = []
    reasons.push(m.tier === 'ticker' ? 'Ticker matched' : m.tier === 'ticker-fuzzy' ? `Ticker read as "${row.label}"` : `Name is close to "${h.name}"`)
    if (it.kind === 'total' && !it.ambiguous) reasons.push(`Read as total value · ${units.toString()} units`)
    if (it.fit === 'both') reasons.push('Could be per unit or total')
    if (it.fit === 'none') reasons.push(last.gt(0) ? `Doesn't look like the last price (${last.toFixed(2)})` : 'No last price to compare with')
    if (reread) reasons.push(`"${row.raw}" taken as ${value.toString()}`)
    if (checked) reasons.push("Agrees with the day's change")
    if (row.ocr < 50) reasons.push('Hard to read')
    let confidence: ScanConfidence = 'medium'
    const weakTicker = m.tier === 'ticker-fuzzy' && (h.ticker?.length ?? 0) <= 4 && m.score < 0.9
    if (it.fit === 'none' || row.ocr < 50 || move > 60 || weakTicker) confidence = 'low'
    else if (m.tier !== 'name' && !reread && row.ocr >= 70 && (it.fit === 'one' || units.lte(1)) && move <= 25) confidence = 'high'
    matches.push({ ...row, value, holdingId: h.id, kind: it.kind, price: it.price, ambiguous: it.ambiguous || reread, confidence, reason: reasons.join(' · ') })
  }
  // the same holding twice: keep the surer reading, then the one higher up
  const byHolding = new Map<string, ScanMatch>()
  for (const x of matches) {
    const cur = byHolding.get(x.holdingId)
    if (!cur || RANK[x.confidence] > RANK[cur.confidence]) byHolding.set(x.holdingId, x)
  }
  const kept = [...byHolding.values()].sort((a, b) => a.y - b.y)
  const seen = new Set(kept.map((x) => x.holdingId))
  return { matches: kept, unmatched, notFound: holdings.filter((h) => !seen.has(h.id)).map((h) => h.id) }
}
