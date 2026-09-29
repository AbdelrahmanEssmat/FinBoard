import { describe, expect, it } from 'vitest'
import { sliceRange, trendStats } from '@/domain/trend'

const pts = (entries: [string, number][]) => entries.map(([date, value]) => ({ date, value }))

describe('trend ranges', () => {
  it('slices from the start of the range', () => {
    const p = pts([['2026-09-01', 1], ['2026-09-20', 2], ['2026-09-27', 3]])
    expect(sliceRange(p, '1W', '2026-09-27').map((x) => x.value)).toEqual([2, 3])
    expect(sliceRange(p, 'ALL', '2026-09-27')).toHaveLength(3)
  })
})

describe('trend stats', () => {
  it('change, percentage, high and low', () => {
    const s = trendStats(pts([['a', 100], ['b', 130], ['c', 90], ['d', 110]]))!
    expect(s.change).toBe(10)
    expect(s.changePct).toBe(10)
    expect(s.high.value).toBe(130)
    expect(s.low.value).toBe(90)
  })
})

