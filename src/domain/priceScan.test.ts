import { describe, expect, it } from 'vitest'
import { groupLines, interpret, levenshtein, matchHolding, readNumber, readRows, scanPrices, type ScanHolding, type ScanWord } from '@/domain/priceScan'

// a word box: Thndr-style screenshot, 920 px wide; text about 30 px tall
const w = (text: string, x0: number, y0: number, width = text.length * 16, h = 30, confidence = 92): ScanWord => ({ text, confidence, x0, y0, x1: x0 + width, y1: y0 + h })

/** One Thndr row: ticker on the left, value top right, change beneath it. */
function thndrRow(ticker: string, value: string, change: string, pct: string, y: number, confidence = 92): ScanWord[] {
  return [w(ticker, 185, y, undefined, 30, confidence), w(value, 740, y - 24, value.length * 20, 30, confidence), w(change, 650, y + 28, undefined, 24, confidence), w('▼', 740, y + 28, 16, 24, 60), w(pct, 770, y + 28, undefined, 24, confidence)]
}

const screenshot: ScanWord[] = [
  w('Net', 155, 210), w('Worth', 215, 210), w('▲', 365, 214, 16), w('0.22%', 400, 210),
  w('Stocks', 78, 350, undefined, 28, 95),
  ...thndrRow('ETEL', '14,800', '+1,359', '10.11%', 490),
  ...thndrRow('ABUK', '10,800', '-592', '5.19%', 672),
  ...thndrRow('MFPC', '6,975', '-559', '7.42%', 854),
  w('Funds', 78, 1010, undefined, 28, 95),
  ...thndrRow('BWA', '49,918', '-81.20', '0.16%', 1154),
  ...thndrRow('BMM', '38,482', '-1,517', '3.79%', 1336),
  ...thndrRow('CMS', '29,943', '-47.75', '0.16%', 1518),
]

const holdings: ScanHolding[] = [
  { id: 'etel', name: 'Telecom Egypt', ticker: 'ETEL', units: 400, current_price: 36 },
  { id: 'abuk', name: 'Abu Qir Fertilizers', ticker: 'ABUK', units: 50, current_price: 230 },
  { id: 'mfpc', name: 'Misr Fertilizers', ticker: 'MFPC', units: 100, current_price: 70 },
  { id: 'bwa', name: 'Beltone Wealth Allocation', ticker: null, units: 2000, current_price: 25 },
  { id: 'bmm', name: 'Beltone Money Market', ticker: 'BMM', units: 1000, current_price: 40 },
  { id: 'cib', name: 'Commercial International Bank', ticker: 'COMI', units: 10, current_price: 80 },
]

describe('reading numbers off a screenshot', () => {
  it('reads plain amounts the way the app shows them', () => {
    expect(readNumber('14,800')!.value.toString()).toBe('14800')
    expect(readNumber('49,918')!.value.toString()).toBe('49918')
    expect(readNumber('1.234,56')!.value.toString()).toBe('1234.56')
    expect(readNumber('36.50')!.value.toString()).toBe('36.5')
    expect(readNumber('E£ 1,200')!.value.toString()).toBe('1200')
  })
  it('offers the other reading of a dot or comma with three digits', () => {
    expect(readNumber('14.800')!.value.toString()).toBe('14.8')
    expect(readNumber('14.800')!.alts.map(String)).toEqual(['14800'])
    expect(readNumber('14,800')!.alts.map(String)).toEqual(['14.8'])
  })
  it('fixes letters the OCR mistakes for digits, only inside a number', () => {
    expect(readNumber('l4,8OO')!.value.toString()).toBe('14800')
    expect(readNumber('ETEL')).toBeNull()
    expect(readNumber('BOO')).toBeNull()
    expect(readNumber('5O')!.value.toString()).toBe('50')
  })
  it('marks changes: a sign, an arrow or a percentage', () => {
    expect(readNumber('+1,359')).toMatchObject({ signed: true, percent: false })
    expect(readNumber('-592')!.signed).toBe(true)
    expect(readNumber('10.11%')).toMatchObject({ signed: false, percent: true })
    expect(readNumber('▼5.19%')).toMatchObject({ signed: true, percent: true })
    expect(readNumber('0')!.value.isZero()).toBe(true)
  })
})

describe('lines and rows', () => {
  it('joins words on one line and keeps lines apart', () => {
    const lines = groupLines([w('ETEL', 185, 490), w('14,800', 740, 466), w('+1,359', 650, 518, undefined, 24), w('ABUK', 185, 672)])
    expect(lines.map((l) => l.map((x) => x.text))).toEqual([['14,800'], ['ETEL'], ['+1,359'], ['ABUK']])
    // a little vertical jitter stays on the line
    expect(groupLines([w('ETEL', 185, 490), w('37.00', 740, 497)]).length).toBe(1)
  })
  it('reads each Thndr row as ticker + value, skipping the change and the headings', () => {
    const rows = readRows(screenshot)
    expect(rows.map((r) => [r.label, r.value.toString()])).toEqual([
      ['ETEL', '14800'],
      ['ABUK', '10800'],
      ['MFPC', '6975'],
      ['BWA', '49918'],
      ['BMM', '38482'],
      ['CMS', '29943'],
    ])
    expect(rows[0]!.raw).toBe('14,800')
    expect(rows[0]!.ocr).toBe(92)
  })
  it('reads a per-unit list with the price on the same line', () => {
    const rows = readRows([w('ETEL', 100, 100), w('37.00', 600, 100), w('ABUK', 100, 160), w('228.50', 600, 160)])
    expect(rows.map((r) => [r.label, r.value.toString()])).toEqual([
      ['ETEL', '37'],
      ['ABUK', '228.5'],
    ])
  })
  it('lends a company name above its ticker to the row', () => {
    const rows = readRows([w('Telecom', 100, 100), w('Egypt', 230, 100), w('ETEL', 100, 132), w('37.00', 600, 132)])
    expect(rows.map((r) => r.label)).toEqual(['Telecom Egypt ETEL'])
  })
  it('does not count units as a price', () => {
    const rows = readRows([w('ETEL', 100, 100), w('400', 300, 100), w('units', 360, 100), w('37.00', 600, 100)])
    expect(rows[0]!.value.toString()).toBe('37')
  })
})

describe('matching a label to a holding', () => {
  it('exact ticker, any case', () => {
    expect(matchHolding('etel', holdings)).toMatchObject({ tier: 'ticker', score: 1 })
    expect(matchHolding('ETEL', holdings)!.holding.id).toBe('etel')
  })
  it('ticker with OCR confusions', () => {
    expect(matchHolding('ETE1', holdings)).toMatchObject({ holding: { id: 'etel' }, tier: 'ticker-fuzzy' })
    expect(matchHolding('MFP0', holdings)!.holding.id).toBe('mfpc')
    expect(matchHolding('C0MI', holdings)!.holding.id).toBe('cib')
  })
  it('a name when there is no ticker', () => {
    expect(matchHolding('Beltone Wealth Allocation', holdings)).toMatchObject({ holding: { id: 'bwa' }, tier: 'name' })
    expect(matchHolding('Beltone Wealth', holdings)!.holding.id).toBe('bwa')
    expect(matchHolding('BWA', holdings)).toMatchObject({ holding: { id: 'bwa' }, tier: 'name' })
  })
  it('gives up when two holdings fit about as well', () => {
    expect(matchHolding('Beltone', holdings)).toBeNull()
    expect(matchHolding('BWM', [holdings[3]!, holdings[4]!, { id: 'bwa2', name: 'x', ticker: 'BWA', units: 1, current_price: 1 }])).toBeNull()
  })
  it('nothing for a stray word', () => {
    expect(matchHolding('Funds', holdings)).toBeNull()
    expect(matchHolding('CMS', holdings)).toBeNull()
  })
  it('levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'ab')).toBe(2)
  })
})

describe('per unit or total', () => {
  const etel = holdings[0]!
  it('a total value when the number is about the position, a price when it is about the last price', () => {
    expect(interpret(d('14800'), etel)).toMatchObject({ kind: 'total', fit: 'one', ambiguous: false })
    expect(interpret(d('14800'), etel).price.toString()).toBe('37')
    expect(interpret(d('37'), etel)).toMatchObject({ kind: 'unit', fit: 'one', ambiguous: false })
  })
  it('one unit: the number is the price', () => {
    expect(interpret(d('110'), { id: 'x', name: 'x', ticker: null, units: 1, current_price: 100 })).toMatchObject({ kind: 'unit', ambiguous: false })
  })
  it('ambiguous when both readings are close to the last price', () => {
    const r = interpret(d('110'), { id: 'x', name: 'x', ticker: null, units: 1.5, current_price: 100 })
    expect(r).toMatchObject({ kind: 'unit', ambiguous: true, fit: 'both' })
  })
  it('no last price: assume a total, and say so', () => {
    expect(interpret(d('500'), { id: 'x', name: 'x', ticker: null, units: 10, current_price: 0 })).toMatchObject({ kind: 'total', ambiguous: true, fit: 'none' })
  })
  it('a forced reading', () => {
    expect(interpret(d('14800'), etel, 'unit')).toMatchObject({ kind: 'unit', fit: 'none' })
    expect(interpret(d('14800'), etel, 'total').price.toString()).toBe('37')
  })
})

describe('the whole scan', () => {
  it('matches the Thndr screenshot to the holdings', () => {
    const r = scanPrices(screenshot, holdings)
    expect(r.matches.map((m) => [m.holdingId, m.kind, m.price.toString(), m.confidence])).toEqual([
      ['etel', 'total', '37', 'high'],
      ['abuk', 'total', '216', 'high'],
      ['mfpc', 'total', '69.75', 'high'],
      ['bwa', 'total', '24.959', 'medium'],
      ['bmm', 'total', '38.482', 'high'],
    ])
    expect(r.unmatched.map((u) => u.label)).toEqual(['CMS'])
    expect(r.notFound).toEqual(['cib'])
    expect(r.matches[0]!.reason).toBe('Ticker matched · Read as total value · 400 units')
    expect(r.matches[3]!.reason).toContain('Name is close to')
  })
  it('takes the other reading of 14.800 when 14.8 fits nothing', () => {
    const r = scanPrices([w('ETEL', 185, 490), w('14.800', 740, 490)], holdings)
    expect(r.matches[0]!.value.toString()).toBe('14800')
    expect(r.matches[0]!.price.toString()).toBe('37')
    expect(r.matches[0]).toMatchObject({ ambiguous: true, confidence: 'medium' })
    expect(r.matches[0]!.reason).toContain('"14.800" taken as 14800')
  })
  it('a big move is low confidence, so it starts unticked', () => {
    const r = scanPrices([w('ETEL', 185, 490), w('30,000', 740, 490)], holdings)
    expect(r.matches[0]!.confidence).toBe('low')
    expect(r.matches[0]!.reason).toContain("Doesn't look like the last price (36.00)")
  })
  it('keeps the surer of two readings of the same holding', () => {
    const r = scanPrices([...thndrRow('ETEL', '14,800', '+1,359', '10.11%', 490), ...thndrRow('ETEL', '30,000', '+1', '1%', 672, 40)], holdings)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.price.toString()).toBe('37')
  })
  it('nothing read: empty result, every holding not found', () => {
    const r = scanPrices([], holdings)
    expect(r.matches).toEqual([])
    expect(r.notFound).toHaveLength(holdings.length)
  })
})

function d(s: string) {
  return readNumber(s)!.value
}

describe('noise', () => {
  it('leaves the clock, battery and logo scraps out of the unmatched list', () => {
    const r = scanPrices([w('wll', 851, 60, 60, 40, 71), w('82', 1008, 60, 80, 40, 5), w('NX', 100, 300, 40, 30, 20), w('4', 300, 300, 20, 30, 30), w('CMS', 100, 500), w('29,943', 700, 500)], holdings.slice(0, 2))
    expect(r.unmatched.map((u) => u.label)).toEqual(['CMS'])
  })
})
