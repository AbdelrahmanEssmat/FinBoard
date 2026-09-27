import { describe, expect, it } from 'vitest'
import { parseBankLive, parseGoldPriceToday, pricesFromGlobalSpot, sanePrices } from '@/domain/goldSources'

describe('gold price sources', () => {
  it('reads banklive.net option values', () => {
    const html = `<select><option value="7126.00">Gold 24 Karat</option><option value="6532.00">Gold 22 Karat</option>
      <option value="6235.00">Gold 21 Karat</option><option value="5344.00">Gold 18 Karat</option></select>`
    const p = parseBankLive(html)
    expect(p).toEqual({ 24: 7126, 22: 6532, 21: 6235, 18: 5344 })
    expect(sanePrices(p)).toBe(true)
  })
  it('falls back to banklive.net JSON-LD text', () => {
    const html = '"The current price of gold is 7,126.00 for 24 karats." "The current price of gold is 6235.00 for 21 karats." "The current price of gold is 5344.00 for 18 karats."'
    expect(parseBankLive(html)).toEqual({ 24: 7126, 21: 6235, 18: 5344 })
  })
  it('reads the gold-price-today.com table', () => {
    const row = (k: number, v: string) => `<span class="x">عيار ${k}</span><div class="y"><span class="text-lg font-bold text-gray-900">${v} <span>ج.م</span></span></div>`
    const html = row(24, '7,120') + row(22, '6,525') + row(21, '6,230') + row(18, '5,340')
    const p = parseGoldPriceToday(html)
    expect(p).toEqual({ 24: 7120, 22: 6525, 21: 6230, 18: 5340 })
    expect(sanePrices(p)).toBe(true)
  })
  it('converts global spot (USD/gram) to EGP', () => {
    const p = pricesFromGlobalSpot({ perGramUsd: { '24k': 137.8, '22k': 126.3, '21k': 120.6, '18k': 103.35 }, currencies: { EGP: 51.75 } })
    expect(p[24]).toBeCloseTo(7131.15, 2)
    expect(sanePrices(p)).toBe(true)
  })
  it('rejects nonsense: missing karats, wrong order, silly ratios or ranges', () => {
    expect(sanePrices({ 24: 7000, 21: 6100 })).toBe(false)
    expect(sanePrices({ 24: 6000, 21: 6100, 18: 5000 })).toBe(false)
    expect(sanePrices({ 24: 7000, 21: 3000, 18: 2000 })).toBe(false)
    expect(sanePrices({ 24: 70, 21: 61, 18: 52 })).toBe(false)
    expect(sanePrices({})).toBe(false)
  })
})
