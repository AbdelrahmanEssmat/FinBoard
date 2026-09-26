import { useMemo } from 'react'
import { useSnapshots } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { convert } from '@/domain/currency'
import { d, type Decimal } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'

export interface HistoryPoint {
  date: string
  value: number
}

/** Daily net-worth snapshots in the display currency, with today's live value appended, plus the 30-day change. */
export function useNetWorthHistory(liveTotal: Decimal) {
  const { data: snapshots } = useSnapshots()
  const { display, tableAt } = useHistoricalConvert()
  const today = todayIso()
  return useMemo(() => {
    const rows: HistoryPoint[] = (snapshots ?? []).slice(-365).map((s) => ({ date: s.snapshot_date, value: (convert(s.total, s.base_currency, display, tableAt(s.snapshot_date)) ?? d(s.total)).toNumber() })) // each day at that day's rate
    const last = rows[rows.length - 1]
    if (!last || last.date !== today) rows.push({ date: today, value: liveTotal.toNumber() })
    else rows[rows.length - 1] = { date: today, value: liveTotal.toNumber() }
    const monthAgo = rows.find((r) => r.date >= addDaysIso(today, -30))
    const change = monthAgo && monthAgo.date !== today ? liveTotal.minus(monthAgo.value) : null
    return { history: rows, change }
  }, [snapshots, display, tableAt, liveTotal, today])
}
