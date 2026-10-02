import { describe, expect, it } from 'vitest'
import { buildReminders, type UpcomingLike } from '@/domain/reminders'

const today = '2026-10-02'
const card: UpcomingLike = { key: 'ccA', date: '2026-10-05', kind: 'card', name: 'QNB', to: '/accounts/A' }

describe('phone reminders', () => {
  it('a card payment is reminded 3 days, 1 day and on the day, never with an amount', () => {
    const r = buildReminders([card], today)
    expect(r.map((x) => [x.remind_on, x.title])).toEqual([
      ['2026-10-02', 'Card payment is due in 3 days'],
      ['2026-10-04', 'Card payment is due tomorrow'],
      ['2026-10-05', 'Card payment is due today'],
    ])
    expect(r.every((x) => !/\d{2,}/.test(x.body))).toBe(true)
    expect(r[0]!.url).toBe('/accounts/A')
  })
  it('only today and later are sent', () => {
    const r = buildReminders([{ ...card, date: '2026-10-03' }], today)
    expect(r.map((x) => x.remind_on)).toEqual(['2026-10-02', '2026-10-03'])
  })
  it('overdue items come back every 3 days, starting the day after', () => {
    const late = (date: string) => buildReminders([{ ...card, date, overdue: true }], today)
    expect(late('2026-10-01').map((x) => x.title)).toEqual(['Card payment is overdue'])
    expect(late('2026-09-30')).toEqual([])
    expect(late('2026-09-28').length).toBe(1)
  })
  it('things that happen by themselves are left alone', () => {
    const r = buildReminders(
      [
        { key: 'p1', date: today, kind: 'payout', auto: true, name: 'CD', to: '/certificates/1' },
        { key: 'y1', date: today, kind: 'cloud', auto: true, name: 'Cloud', to: '/investments' },
        { key: 'r1', date: '2026-10-03', kind: 'recurring', auto: true, incoming: true, name: 'Salary', to: '/recurring' },
      ],
      today,
    )
    expect(r).toEqual([])
  })
  it('an automatic bill gets a heads-up the day before; one to confirm is reminded on the day', () => {
    const r = buildReminders(
      [
        { key: 'r1', date: '2026-10-03', kind: 'recurring', auto: true, name: 'Rent', to: '/recurring' },
        { key: 'r2', date: '2026-10-03', kind: 'recurring', auto: false, name: 'Gym', to: '/recurring' },
      ],
      today,
    )
    expect(r.map((x) => [x.remind_on, x.title])).toEqual([
      ['2026-10-02', 'Rent goes out tomorrow'],
      ['2026-10-02', 'Gym is due tomorrow'],
      ['2026-10-03', 'Gym is due today'],
    ])
  })
  it('debts read the right way round', () => {
    const r = buildReminders(
      [
        { key: 'd1', date: today, kind: 'debt', name: 'Omar', to: '/debts/1' },
        { key: 'd2', date: today, kind: 'debt', incoming: true, name: 'Sara', to: '/debts/2' },
      ],
      today,
    )
    expect(r.map((x) => x.title).sort()).toEqual(['Sara is due to pay you today', 'Your payment to Omar is due today'])
  })
})
