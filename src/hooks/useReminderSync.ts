import { useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/api/supabase'
import { usePushSubscriptions } from '@/api/queries'
import { useUpcoming } from '@/features/dashboard/useUpcoming'
import { buildReminders } from '@/domain/reminders'
import { todayIso } from '@/domain/format'
import type { Json } from '@/api/database.types'
import { refreshPushRegistration } from '@/features/reminders/push'

/**
 * Keeps the server's list of upcoming reminders in step with what's coming up (card payments,
 * instalments, bills, certificate payouts and maturities), whenever that changes. Only once this
 * person has turned reminders on for at least one device.
 */
export function useReminderSync() {
  const { data: devices } = usePushSubscriptions()
  const upcoming = useUpcoming(14, 500)
  const today = todayIso()
  const reminders = useMemo(() => buildReminders(upcoming, today), [upcoming, today])
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
