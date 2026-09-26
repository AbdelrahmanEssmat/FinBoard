/* Local-date helpers. Never go through toISOString(): in UTC+2/+3 it shifts the day. */

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function toIsoDate(dt: Date): string {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function startOfMonthIso(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`
}

export function endOfMonthIso(date = new Date()): string {
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

export function addDaysIso(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00')
  dt.setDate(dt.getDate() + days)
  return toIsoDate(dt)
}

export function addMonthsDate(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000)
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function monthLabel(date: Date, style: 'short' | 'long' = 'long'): string {
  return date.toLocaleDateString('en-GB', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) })
}
