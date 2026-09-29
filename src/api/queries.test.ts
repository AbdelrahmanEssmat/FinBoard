import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/supabase', () => ({ supabase: {}, isNetworkError: () => false }))

import { fetchPaged } from '@/api/queries'

/** A fake query whose .range(from, to) hands out `total` rows a page at a time. */
function source(total: number) {
  const calls: [number, number][] = []
  const build = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to])
      const data = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i }))
      return { data, error: null }
    },
  })
  return { build, calls }
}

describe('fetchPaged', () => {
  it('reads past the 1000-row page limit until a short page comes back', async () => {
    const s = source(1005)
    const rows = await fetchPaged<{ id: number }>(s.build)
    expect(rows).toHaveLength(1005)
    expect(rows[1004]!.id).toBe(1004)
    expect(s.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
  it('stops after an exactly full last page', async () => {
    const s = source(2000)
    expect(await fetchPaged(s.build)).toHaveLength(2000)
    expect(s.calls).toHaveLength(3) // the third page is empty
  })
  it('caps at the limit', async () => {
    const s = source(5000)
    expect(await fetchPaged(s.build, 1500)).toHaveLength(1500)
    expect(s.calls).toEqual([
      [0, 999],
      [1000, 1499],
    ])
  })
  it('throws the server error', async () => {
    await expect(fetchPaged(() => ({ range: async () => ({ data: null, error: new Error('nope') }) }))).rejects.toThrow('nope')
  })
})
