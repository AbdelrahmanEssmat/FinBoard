import { describe, expect, it } from 'vitest'
import { dueOccurrences, upcomingOccurrences } from '@/domain/recurring'

describe('recurring', () => {
  const r = { frequency: 'monthly' as const, interval_count: 1, next_date: '2026-07-31', is_active: true }
  it('lists due occurrences up to today, month-end safe', () => {
    expect(dueOccurrences(r, '2026-09-26')).toEqual(['2026-07-31', '2026-08-31'])
  })
  it('respects end_date and inactive', () => {
    expect(dueOccurrences({ ...r, end_date: '2026-08-01' }, '2026-09-26')).toEqual(['2026-07-31'])
    expect(dueOccurrences({ ...r, is_active: false }, '2026-09-26')).toEqual([])
  })
  it('upcoming within a window', () => {
    expect(upcomingOccurrences({ ...r, next_date: '2026-10-01' }, '2026-09-26', 30)).toEqual(['2026-10-01'])
    expect(upcomingOccurrences({ ...r, next_date: '2026-11-01' }, '2026-09-26', 30)).toEqual([])
  })
})
