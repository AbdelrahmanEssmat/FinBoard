import { useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/api/supabase'
import { useHoldings, usePushSubscriptions } from '@/api/queries'
import { useUpcoming } from '@/features/dashboard/useUpcoming'
import { buildReminders, extraReminders } from '@/domain/reminders'
import { useBudgetUsage } from '@/features/budgets/useBudgetUsage'
import { d } from '@/domain/money'
import { addDaysIso } from '@/utils'
import { todayIso } from '@/domain/format'
import type { Json } from '@/api/database.types'
import { refreshPushRegistration } from '@/features/reminders/push'

/**
 * Keeps the server's list of upcoming reminders in step with what's coming up (card payments,
 * instalments, bills, certificate payouts and maturities) plus a few general ones (the end-of-day
 * check-in, last month's summary, out-of-date prices, nearly used budgets), whenever that changes. Only once this
 * person has turned reminders on for at least one device.
 */
export function useReminderSync() {
  const { data: devices } = usePushSubscriptions()
  const upcoming = useUpcoming(14, 500)
  const today = todayIso()
  const { data: holdings } = useHoldings()
  const { rows: budgetRows } = useBudgetUsage()
  const reminders = useMemo(() => {
    const weekAgo = addDaysIso(today, -7)
    // an open stock or fund whose price hasn't been updated for more than a week
    const pricesOutOfDate = (holdings ?? []).some((h) => d(h.units).gt(0) && (!h.price_updated_at || h.price_updated_at.slice(0, 10) < weekAgo))
    const budgets = budgetRows.map((r) => ({ categoryId: r.b.category_id, name: r.cat?.name ?? 'A', pct: r.pct }))
    return [...buildReminders(upcoming, today), ...extraReminders({ today, days: 14, pricesOutOfDate, budgets })]
  }, [upcoming, today, holdings, budgetRows])
  const synced = useRef<string | null>(null)
  const on = (devices?.length ?? 0) > 0

  // once per app start: keep this device's push address current (browsers renew it now and then)
  useEffect(() => {
    void refreshPushRegistration()
  }, [])

  useEffect(() => {
    if (!on) return
    const signature = JSON.stringify(reminders)
    if (signature === synced.current) return
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) return
      const { error } = await supabase.rpc('replace_reminders', { p_items: reminders as unknown as Json })
      if (!error) synced.current = signature
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [on, reminders])
}
