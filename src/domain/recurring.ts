import { format, parseISO } from 'date-fns'
import { addPeriod, type Recurrence } from './installments'

export interface RecurringLike {
  frequency: Recurrence
  interval_count: number
  next_date: string
  end_date?: string | null
  is_active: boolean
}

/** Occurrences due on or before `today`, in order. */
export function dueOccurrences(r: RecurringLike, today: string): string[] {
  if (!r.is_active) return []
  const out: string[] = []
  let cur = parseISO(r.next_date)
  for (let guard = 0; guard < 1000; guard++) {
    const isoDate = format(cur, 'yyyy-MM-dd')
    if (isoDate > today) break
    if (r.end_date && isoDate > r.end_date) break
    out.push(isoDate)
    cur = addPeriod(cur, r.frequency, r.interval_count)
  }
  return out
}

/** Upcoming occurrences within the next `days` days (strictly after today). */
export function upcomingOccurrences(r: RecurringLike, today: string, days: number): string[] {
  if (!r.is_active) return []
  const limit = format(addPeriod(parseISO(today), 'daily', days), 'yyyy-MM-dd')
  const out: string[] = []
  let cur = parseISO(r.next_date)
  for (let guard = 0; guard < 1000; guard++) {
    const isoDate = format(cur, 'yyyy-MM-dd')
    if (isoDate > limit) break
    if (r.end_date && isoDate > r.end_date) break
    if (isoDate >= today) out.push(isoDate)
    cur = addPeriod(cur, r.frequency, r.interval_count)
  }
  return out
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}
