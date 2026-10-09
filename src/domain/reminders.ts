/**
 * Phone reminders, worked out on the device from what's coming up and sent by the server on the
 * day. They show on the lock screen, so they never contain amounts.
 */
export interface UpcomingLike {
  key: string
  date: string
  kind: 'payout' | 'maturity' | 'cloud' | 'debt' | 'card' | 'recurring'
  overdue?: boolean
  auto?: boolean
  incoming?: boolean
  name?: string
  to: string
}

export interface ReminderItem {
  key: string
  remind_on: string
  title: string
  body: string
  url: string
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)

const when = (daysBefore: number) => (daysBefore === 0 ? 'today' : daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`)

/** Which days before the due date each kind of item is worth a reminder. */
const SCHEDULE: Record<UpcomingLike['kind'], number[]> = {
  card: [3, 1, 0],
  debt: [1, 0],
  maturity: [7, 1, 0],
  payout: [0],
  recurring: [1, 0],
  cloud: [],
}

function text(item: UpcomingLike, daysBefore: number | 'overdue'): { title: string; body: string } | null {
  const name = (item.name ?? '').trim()
  const due = daysBefore === 'overdue' ? 'is overdue' : `is due ${when(daysBefore)}`
  switch (item.kind) {
    case 'card':
      return { title: `Card payment ${due}`, body: `${name || 'Your credit card'}: open FinBoard to see what's left to pay.` }
    case 'debt':
      return item.incoming
        ? { title: daysBefore === 'overdue' ? `${name || 'A repayment'} is late paying you` : `${name || 'Someone'} is due to pay you ${when(daysBefore as number)}`, body: 'Record the repayment in FinBoard when it arrives.' }
        : { title: `Your payment to ${name || 'someone'} ${due}`, body: 'Record it in FinBoard once you’ve paid.' }
    case 'maturity':
      return { title: `${name || 'A certificate'} matures ${when(daysBefore as number)}`, body: 'Decide whether to renew it or move the money.' }
    case 'payout':
      // payouts logged automatically need nothing from you
      return item.auto ? null : { title: `${name || 'Certificate'} interest ${daysBefore === 'overdue' ? 'is waiting to be logged' : 'is due today'}`, body: 'Log it in FinBoard when it reaches your account.' }
    case 'recurring':
      if (item.incoming && item.auto) return null // money coming in by itself: no need to nag
      if (item.auto) return daysBefore === 1 ? { title: `${name || 'A bill'} goes out tomorrow`, body: 'FinBoard records it automatically.' } : null
      return { title: `${name || 'A recurring item'} ${due}`, body: 'Confirm it in FinBoard when it happens.' }
    default:
      return null
  }
}

/** The reminders for the coming days (only today onwards; overdue items are repeated every 3 days). */
export function buildReminders(items: UpcomingLike[], today: string): ReminderItem[] {
  const out: ReminderItem[] = []
  const seen = new Set<string>()
  const push = (item: UpcomingLike, on: string, label: number | 'overdue') => {
    const t = text(item, label)
    if (!t) return
    const key = `${item.key}:${label}`
    if (seen.has(key + on)) return
    seen.add(key + on)
    out.push({ key, remind_on: on, title: t.title.slice(0, 120), body: t.body.slice(0, 300), url: item.to })
  }
  for (const item of items) {
    if (item.date < today || item.overdue) {
      if (item.kind === 'card' || item.kind === 'debt' || item.kind === 'payout') {
        const late = daysBetween(item.date, today)
        if (late >= 1 && (late - 1) % 3 === 0) push(item, today, 'overdue')
      }
      continue
    }
    for (const before of SCHEDULE[item.kind]) {
      const on = addDays(item.date, -before)
      if (on >= today) push(item, on, before)
    }
  }
  return out.sort((a, b) => a.remind_on.localeCompare(b.remind_on) || a.key.localeCompare(b.key))
}

export interface ExtraReminderInput {
  today: string
  /** how many days ahead to schedule (the same window as the other reminders) */
  days: number
  /** some open stock or fund has a price older than a week */
  pricesOutOfDate: boolean
  /** this month's budgets and how much of each is spent (percent) */
  budgets: { categoryId: string; name: string; pct: number }[]
}

/** First day of the month after `iso`'s. */
const nextMonthStart = (iso: string) => {
  const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}
/** The Monday of `iso`'s week. */
const weekStart = (iso: string) => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7))
const monthName = (iso: string) => new Date(iso.slice(0, 7) + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })

/**
 * The few general reminders, on top of the ones for things that are due:
 * - every evening, "anything to add for today?" (the server sends it only on days nothing was recorded)
 * - on the 1st, last month's summary is ready
 * - at most once a week, when stock or fund prices are more than a week old
 * - once a month per budget, when 90% of it is spent (and again when it is all spent)
 * Keys starting "evening:" go out in the evening run; keys starting "once:" are never sent twice.
 */
export function extraReminders(input: ExtraReminderInput): ReminderItem[] {
  const { today, days } = input
  const out: ReminderItem[] = []
  for (let i = 0; i < days; i++) {
    const on = addDays(today, i)
    out.push({ key: `evening:checkin:${on}`, remind_on: on, title: 'Anything to add for today?', body: 'Record today’s spending in FinBoard before you forget.', url: '/' })
  }
  const first = today.endsWith('-01') ? today : nextMonthStart(today)
  if (daysBetween(today, first) < days) {
    const last = addDays(first, -1)
    out.push({ key: `once:month:${last.slice(0, 7)}`, remind_on: first, title: `Your ${monthName(last)} summary is ready`, body: 'See where your money went last month.', url: '/reports?period=last' })
  }
  if (input.pricesOutOfDate) {
    out.push({ key: `once:prices:${weekStart(today)}`, remind_on: today, title: 'Your stock prices are out of date', body: 'Update them so your net worth stays right.', url: '/investments/prices' })
  }
  for (const b of input.budgets) {
    if (b.pct < 90) continue
    const full = b.pct >= 100
    out.push({
      key: `once:budget:${b.categoryId}:${today.slice(0, 7)}:${full ? 'full' : '90'}`,
      remind_on: today,
      title: full ? `${b.name} budget is used up` : `${b.name} budget is almost used`,
      body: full ? 'You’ve spent all of it this month.' : 'You’ve spent 90% of it this month.',
      url: '/budgets',
    })
  }
  return out
}
