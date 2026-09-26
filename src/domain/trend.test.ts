import { describe, expect, it } from 'vitest'
import { availableRanges, monotonePath, sliceRange, trendStats, yDomain } from '@/domain/trend'

const pts = (entries: [string, number][]) => entries.map(([date, value]) => ({ date, value }))

describe('trend ranges', () => {
  it('offers only ranges that add history', () => {
    expect(availableRanges(pts([['2026-09-27', 1]]), '2026-09-27')).toEqual([])
    expect(availableRanges(pts([['2026-09-26', 1], ['2026-09-27', 2]]), '2026-09-27')).toEqual(['1W'])
    expect(availableRanges(pts([['2026-09-10', 1], ['2026-09-27', 2]]), '2026-09-27')).toEqual(['1W', '1M'])
    expect(availableRanges(pts([['2025-01-01', 1], ['2026-09-27', 2]]), '2026-09-27')).toEqual(['1W', '1M', '3M', '1Y', 'ALL'])
  })
  it('slices from the start of the range', () => {
    const p = pts([['2026-09-01', 1], ['2026-09-20', 2], ['2026-09-27', 3]])
    expect(sliceRange(p, '1W', '2026-09-27').map((x) => x.value)).toEqual([2, 3])
    expect(sliceRange(p, 'ALL', '2026-09-27')).toHaveLength(3)
  })
})

describe('trend stats and axis', () => {
  it('change, percentage, high and low', () => {
    const s = trendStats(pts([['a', 100], ['b', 130], ['c', 90], ['d', 110]]))!
    expect(s.change).toBe(10)
    expect(s.changePct).toBe(10)
    expect(s.high.value).toBe(130)
    expect(s.low.value).toBe(90)
  })
  it('a flat line sits in the middle instead of at the top', () => {
    const [lo, hi] = yDomain([100000, 100000])
    expect(lo).toBeLessThan(100000)
    expect(hi).toBeGreaterThan(100000)
    expect((lo + hi) / 2).toBeCloseTo(100000)
  })
  it('a tiny wobble is not exaggerated (visible span at least 2%)', () => {
    const [lo, hi] = yDomain([100000, 100050])
    expect(hi - lo).toBeGreaterThanOrEqual(2000)
  })
  it('a real move fills the chart', () => {
    const [lo, hi] = yDomain([80000, 120000])
    expect(lo).toBeLessThan(80000)
    expect(hi).toBeGreaterThan(120000)
    expect(hi - lo).toBeLessThan(50000)
  })
})

describe('monotone path', () => {
  it('never overshoots between points', () => {
    const d = monotonePath([0, 10, 20], [50, 0, 0])
    // control points of the flat second segment stay on y = 0
    expect(d).toContain('C')
    const nums = d.replace(/[MC]/g, ' ').trim().split(/[\s,]+/).map(Number)
    expect(Math.min(...nums.filter((_, i) => i % 2 === 1))).toBeGreaterThanOrEqual(0)
  })
  it('handles one and two points', () => {
    expect(monotonePath([5], [5])).toBe('M5,5')
    expect(monotonePath([0, 10], [0, 10])).toMatch(/^M0,0 C/)
  })
})
