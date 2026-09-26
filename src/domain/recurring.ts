import { format, parseISO } from 'date-fns'
import { addPeriod, type Recurrence } from '@/domain/installments'

export interface RecurringLike {
  frequency: Recurrence
  interval_count: number
  next_date: string
  /** Fixed start of the schedule; occurrences are anchor + k × interval, so the 31st stays the 31st (or month end). */
  anchor_date?: string | null
  end_date?: string | null
  is_active: boolean
}

/**
 * Every occurrence of the rule from `next_date` onwards, computed from the anchor (matches
 * public.post_due_recurring). Stops at `until` or the end date.
 */
function occurrences(r: RecurringLike, until: string): string[] {
  const anchor = parseISO(r.anchor_date ?? r.next_date)
  const out: string[] = []
  for (let k = 0; k < 5000; k++) {
    const iso = format(addPeriod(anchor, r.frequency, k * r.interval_count), 'yyyy-MM-dd')
    if (iso > until) break
    if (r.end_date && iso > r.end_date) break
    if (iso >= r.next_date) out.push(iso)
  }
  return out
}

/** Occurrences due on or before `today`, in order. */
export function dueOccurrences(r: RecurringLike, today: string): string[] {
  if (!r.is_active) return []
  return occurrences(r, today)
}

/** Occurrences from today (inclusive) through the next `days` days. */
export function upcomingOccurrences(r: RecurringLike, today: string, days: number): string[] {
  if (!r.is_active) return []
  const limit = format(addPeriod(parseISO(today), 'daily', days), 'yyyy-MM-dd')
  return occurrences(r, limit).filter((d) => d >= today)
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}
