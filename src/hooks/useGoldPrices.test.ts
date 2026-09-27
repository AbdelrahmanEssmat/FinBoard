import { describe, expect, it } from 'vitest'
import { latestGoldPrices } from '@/hooks/useGoldPrices'
import type { GoldPrice } from '@/api/database.types'

const now = new Date('2026-09-26T12:00:00Z').getTime()
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()
const row = (over: Partial<GoldPrice>): GoldPrice => ({
  id: Math.random().toString(), user_id: null, karat: 21, price_per_gram: 4000, currency: 'EGP', source: 'local', source_name: 'x', price_at: hoursAgo(0), created_at: hoursAgo(0), ...over,
})

describe('gold price precedence (matches the database)', () => {
  it('a manual price from the last 24 hours beats a newer automatic one', () => {
    const t = latestGoldPrices([row({ price_per_gram: 4000, price_at: hoursAgo(0.2) }), row({ user_id: 'me', source: 'manual', price_per_gram: 5000, price_at: hoursAgo(1) })], now)
    expect(t.perGram[21]).toBe(5000)
    expect(t.source).toBe('manual')
  })
  it('after 24 hours the newest price wins again', () => {
    const t = latestGoldPrices([row({ price_per_gram: 4000, price_at: hoursAgo(0.2) }), row({ user_id: 'me', source: 'manual', price_per_gram: 5000, price_at: hoursAgo(25) })], now)
    expect(t.perGram[21]).toBe(4000)
  })
  it("a price the app fetched and saved under the user's account is automatic, not an override", () => {
    const t = latestGoldPrices([row({ user_id: 'me', source: 'local', price_per_gram: 4000, price_at: hoursAgo(2) }), row({ user_id: 'me', source: 'local', price_per_gram: 4200, price_at: hoursAgo(0.5) })], now)
    expect(t.perGram[21]).toBe(4200)
    expect(t.source).toBe('local')
  })
  it('newest automatic price wins among automatic prices', () => {
    const t = latestGoldPrices([row({ price_per_gram: 3900, price_at: hoursAgo(2) }), row({ price_per_gram: 4100, price_at: hoursAgo(1) })], now)
    expect(t.perGram[21]).toBe(4100)
  })
})
