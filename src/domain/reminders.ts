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
