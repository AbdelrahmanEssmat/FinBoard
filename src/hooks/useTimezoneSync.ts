import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { useSettings } from '@/api/queries'

/** The device's time zone (e.g. Africa/Cairo), or null if the browser doesn't say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/**
 * Keeps settings.timezone the same as this device's, so the server's "today" (recurring bills,
 * interest, payouts, the daily net worth) matches the dates the app shows, at home or abroad.
 */
export function useTimezoneSync() {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const current = settings?.timezone
  const userId = settings?.user_id

  useEffect(() => {
    const tz = deviceTimeZone()
    if (!userId || !tz || !current || tz === current || !navigator.onLine) return
    void supabase
      .from('settings')
      .update({ timezone: tz })
      .eq('user_id', userId)
      .then(({ error }) => {
        // an unknown zone name is refused by the server: then the previous one simply stays
        if (!error) void qc.invalidateQueries({ queryKey: ['settings'] })
      })
  }, [current, userId, qc])
}
