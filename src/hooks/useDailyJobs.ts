import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { todayIso } from '@/domain/format'

/**
 * Housekeeping once a day: post due recurring transactions, auto-log certificate payouts,
 * accrue Cloud interest and snapshot today's net worth. (Rates and gold prices: useMarketData.)
 * Runs on open and again as soon as the app is looked at on a new day (an installed app can stay
 * open for weeks). The same work runs nightly in Postgres (pg_cron); this covers days it did not.
 */
export function useDailyJobs() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const running = useRef(false)
  /** the day the jobs last completed; a failed or offline attempt is retried on the next trigger */
  const lastRunDate = useRef<string | null>(null)

  useEffect(() => {
    const userId = session?.user.id ?? null
    if (!userId) return
    lastRunDate.current = null

    const run = async () => {
      if (running.current || !navigator.onLine) return
      running.current = true
      try {
        const [rec, pay, yld] = await Promise.all([supabase.rpc('post_due_recurring'), supabase.rpc('process_certificate_payouts'), supabase.rpc('accrue_yield')])
        const { error } = await supabase.rpc('snapshot_net_worth')
        if (rec.error || pay.error || yld.error || error) return
        lastRunDate.current = todayIso()
        if ((rec.data ?? 0) > 0 || (pay.data ?? 0) > 0 || (yld.data ?? 0) > 0) {
          for (const key of ['transactions', 'sub_accounts', 'recurring_transactions', 'certificate_payouts']) await qc.invalidateQueries({ queryKey: [key] })
        }
        await qc.invalidateQueries({ queryKey: ['net_worth_snapshots'] })
      } catch {
        /* offline or not yet configured */
      } finally {
        running.current = false
      }
    }

    const check = () => {
      if (document.visibilityState === 'visible' && todayIso() !== lastRunDate.current) void run()
    }
    check()
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
    }
  }, [qc, session?.user.id])
}
