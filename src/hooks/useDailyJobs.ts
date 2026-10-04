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
        const [rec, pay, yld, mdebts] = await Promise.all([
          supabase.rpc('post_due_recurring'),
          supabase.rpc('process_certificate_payouts'),
          supabase.rpc('accrue_yield'),
          supabase.rpc('post_due_recurring_debts'),
        ])
        const { error } = await supabase.rpc('snapshot_net_worth')
        // monthly debts need migration 0018; until it runs the function is missing (PGRST202), which is fine
        const debtsError = mdebts.error && mdebts.error.code !== 'PGRST202'
        if (rec.error || pay.error || yld.error || debtsError || error) return
        lastRunDate.current = todayIso()
        if ((rec.data ?? 0) > 0 || (pay.data ?? 0) > 0 || (yld.data ?? 0) > 0 || (mdebts.data ?? 0) > 0) {
          for (const key of ['transactions', 'sub_accounts', 'recurring_transactions', 'certificate_payouts', 'debts', 'recurring_debts']) await qc.invalidateQueries({ queryKey: [key] })
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
    // Today's net worth snapshot is the one the history and reports use for today: refresh it when
    // money changes (on this device or another), not only once a day, so the day's last value is kept.
    const MONEY = new Set(['sub_accounts', 'holdings', 'gold_items', 'gold_prices', 'debts', 'debt_payments', 'certificates', 'exchange_rates'])
    let dirty = false
    let pending: number | undefined
    const snapshot = async () => {
      window.clearTimeout(pending)
      pending = undefined
      if (!dirty || !navigator.onLine) return
      dirty = false
      const { error } = await supabase.rpc('snapshot_net_worth')
      if (error) dirty = true
      else void qc.invalidateQueries({ queryKey: ['net_worth_snapshots'] })
    }
    const unsubscribe = qc.getQueryCache().subscribe((e) => {
      if (e.type !== 'updated' || e.action.type !== 'success' || !MONEY.has(String(e.query.queryKey[0]))) return
      dirty = true
      if (pending === undefined) pending = window.setTimeout(() => void snapshot(), 20_000)
    })
    const onHide = () => {
      if (document.visibilityState === 'hidden') void snapshot()
    }

    check()
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    return () => {
      unsubscribe()
      window.clearTimeout(pending)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
    }
  }, [qc, session?.user.id])
}
