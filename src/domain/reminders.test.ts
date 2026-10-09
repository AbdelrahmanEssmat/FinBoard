import { describe, expect, it } from 'vitest'
import { buildReminders, extraReminders, type UpcomingLike } from '@/domain/reminders'

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

describe('general reminders', () => {
  const base = { today: '2026-10-10', days: 14, pricesOutOfDate: false, budgets: [] }
  it('asks every evening for the next two weeks', () => {
    const items = extraReminders(base).filter((r) => r.key.startsWith('evening:checkin:'))
    expect(items).toHaveLength(14)
    expect(items[0]).toMatchObject({ remind_on: '2026-10-10', title: 'Anything to add for today?' })
    expect(items[13]!.remind_on).toBe('2026-10-23')
  })
  it('says last month’s summary is ready on the 1st, once', () => {
    expect(extraReminders({ ...base, today: '2026-10-25' }).find((r) => r.key.startsWith('once:month:'))).toMatchObject({
      key: 'once:month:2026-10',
      remind_on: '2026-11-01',
      title: 'Your October summary is ready',
      url: '/reports?period=last',
    })
    expect(extraReminders({ ...base, today: '2026-11-01' }).find((r) => r.key.startsWith('once:month:'))!.remind_on).toBe('2026-11-01')
    // too far ahead: not yet
    expect(extraReminders(base).some((r) => r.key.startsWith('once:month:'))).toBe(false)
  })
  it('nudges about old prices at most once a week', () => {
    const r = extraReminders({ ...base, pricesOutOfDate: true }).find((x) => x.key.startsWith('once:prices:'))!
    expect(r.key).toBe('once:prices:2026-10-05') // the Monday of that week
    expect(extraReminders({ ...base, today: '2026-10-11', pricesOutOfDate: true }).find((x) => x.key.startsWith('once:prices:'))!.key).toBe(r.key)
  })
  it('warns at 90% and when a budget is used up, never with amounts', () => {
    const items = extraReminders({ ...base, budgets: [{ categoryId: 'food', name: 'Food', pct: 92 }, { categoryId: 'fun', name: 'Fun', pct: 130 }, { categoryId: 'rent', name: 'Rent', pct: 50 }] })
    const budgets = items.filter((r) => r.key.startsWith('once:budget:'))
    expect(budgets.map((r) => r.title)).toEqual(['Food budget is almost used', 'Fun budget is used up'])
    expect(budgets[0]!.key).toBe('once:budget:food:2026-10:90')
    for (const r of items) expect(`${r.title} ${r.body}`).not.toMatch(/E£|\d{3}/)
  })
})
