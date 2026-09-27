import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'

/**
 * Housekeeping on app open: post due recurring transactions, auto-log certificate payouts,
 * accrue Cloud interest and snapshot today's net worth. (Rates and gold prices: useMarketData.)
 * The same work runs nightly in Postgres (pg_cron); this covers days it did not.
 */
export function useDailyJobs() {
  const qc = useQueryClient()
  const { session } = useAuth()
  useEffect(() => {
    if (!session || !navigator.onLine) return
    const run = async () => {
      try {
        const [rec, pay, yld] = await Promise.all([supabase.rpc('post_due_recurring'), supabase.rpc('process_certificate_payouts'), supabase.rpc('accrue_yield')])
        await supabase.rpc('snapshot_net_worth')
        if ((rec.data ?? 0) > 0 || (pay.data ?? 0) > 0 || (yld.data ?? 0) > 0) {
          for (const key of ['transactions', 'sub_accounts', 'recurring_transactions', 'certificate_payouts']) await qc.invalidateQueries({ queryKey: [key] })
        }
        await qc.invalidateQueries({ queryKey: ['net_worth_snapshots'] })
      } catch {
        /* offline or not yet configured */
      }
    }
    void run()
  }, [qc, session])
}
