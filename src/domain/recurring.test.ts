import { describe, expect, it } from 'vitest'
import { dueOccurrences, upcomingOccurrences } from '@/domain/recurring'

describe('recurring', () => {
  const r = { frequency: 'monthly' as const, interval_count: 1, next_date: '2026-07-31', is_active: true }
  it('lists due occurrences up to today, month-end safe', () => {
    expect(dueOccurrences(r, '2026-09-26')).toEqual(['2026-07-31', '2026-08-31'])
  })
  it('a rule on the 31st never drifts to the 28th', () => {
    const jan31 = { frequency: 'monthly' as const, interval_count: 1, next_date: '2026-01-31', anchor_date: '2026-01-31', is_active: true }
    expect(dueOccurrences(jan31, '2026-06-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    // after posting, next_date is 2026-07-31 and the anchor still decides the day
    expect(upcomingOccurrences({ ...jan31, next_date: '2026-07-31' }, '2026-07-01', 70)).toEqual(['2026-07-31', '2026-08-31'])
  })
  it('every 2 months from the anchor', () => {
    expect(dueOccurrences({ frequency: 'monthly', interval_count: 2, next_date: '2026-01-31', anchor_date: '2026-01-31', is_active: true }, '2026-08-01')).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31',
    ])
  })
  it('respects end_date and inactive', () => {
    expect(dueOccurrences({ ...r, end_date: '2026-08-01' }, '2026-09-26')).toEqual(['2026-07-31'])
    expect(dueOccurrences({ ...r, is_active: false }, '2026-09-26')).toEqual([])
  })
  it('upcoming within a window, including today', () => {
    expect(upcomingOccurrences({ ...r, next_date: '2026-10-01' }, '2026-09-26', 30)).toEqual(['2026-10-01'])
    expect(upcomingOccurrences({ ...r, next_date: '2026-11-01' }, '2026-09-26', 30)).toEqual([])
    expect(upcomingOccurrences({ ...r, next_date: '2026-09-26' }, '2026-09-26', 5)).toEqual(['2026-09-26'])
  })
})
