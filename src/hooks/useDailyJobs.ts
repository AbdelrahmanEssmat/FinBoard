import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { refreshRatesFromClient } from '@/api/ratesProvider'
import { useAuth } from '@/app/providers/AuthProvider'

/**
 * Housekeeping on app open: make sure today's rates exist, post due recurring
 * transactions, auto-log certificate payouts and snapshot today's net worth.
 * The same work runs nightly in Postgres (pg_cron); this covers days it did not.
 */
export function useDailyJobs() {
  const qc = useQueryClient()
  const { session } = useAuth()
  useEffect(() => {
    if (!session || !navigator.onLine) return
    const run = async () => {
      try {
        try {
          const { data: currencies } = await supabase.from('currencies').select('code,is_active').eq('is_active', true)
          const n = await refreshRatesFromClient((currencies ?? []).map((c) => c.code), session.user.id)
          if (n > 0) await qc.invalidateQueries({ queryKey: ['exchange_rates'] })
        } catch {
          /* rate provider unreachable */
        }
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
