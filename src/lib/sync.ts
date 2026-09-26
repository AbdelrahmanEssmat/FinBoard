import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, isLocalStack } from './supabase'
import { flushOutbox } from './offline/mutate'
import { onOutboxChange, pendingCount } from './offline/outbox'
import { ALL_TABLES } from './data/tables'
import { useAuth } from './auth'
import { refreshRatesFromClient } from '@/features/settings/rates'

/** Realtime subscription: any change in my rows refreshes the matching query. */
export function useRealtimeSync() {
  const qc = useQueryClient()
  const { session } = useAuth()
  useEffect(() => {
    if (!session || isLocalStack) return
    const channel = supabase.channel('db-changes')
    for (const table of ALL_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void qc.invalidateQueries({ queryKey: [table] })
      })
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [qc, session])
}

/** Online/offline status + pending outbox count; flushes the outbox when back online. */
export function useConnectivity() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(0)

  useEffect(() => {
    const refresh = () => void pendingCount().then(setPending)
    refresh()
    return onOutboxChange(refresh)
  }, [])

  useEffect(() => {
    const flush = async () => {
      if (!session) return
      const { sent } = await flushOutbox()
      if (sent > 0) await qc.invalidateQueries()
    }
    const goOnline = () => {
      setOnline(true)
      void flush()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    if (navigator.onLine) void flush()
    const timer = window.setInterval(() => navigator.onLine && void flush(), 60_000)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.clearInterval(timer)
    }
  }, [qc, session])

  return { online, pending }
}

/** Housekeeping on app open: post due recurring, log certificate payouts, take today's net worth snapshot. */
export function useDailyJobs() {
  const qc = useQueryClient()
  const { session } = useAuth()
  useEffect(() => {
    if (!session || !navigator.onLine) return
    const key = `jobs-ran-${new Date().toISOString().slice(0, 10)}`
    const run = async () => {
      try {
        // make sure today's exchange rates exist (fallback when the edge function is not deployed yet)
        try {
          const { data: currencies } = await supabase.from('currencies').select('code,is_active').eq('is_active', true)
          const n = await refreshRatesFromClient((currencies ?? []).map((c) => c.code), session.user.id)
          if (n > 0) await qc.invalidateQueries({ queryKey: ['exchange_rates'] })
        } catch {
          /* rate provider unreachable */
        }
        const [rec, pay] = await Promise.all([supabase.rpc('post_due_recurring'), supabase.rpc('process_certificate_payouts')])
        await supabase.rpc('snapshot_net_worth')
        if ((rec.data ?? 0) > 0 || (pay.data ?? 0) > 0) {
          await qc.invalidateQueries({ queryKey: ['transactions'] })
          await qc.invalidateQueries({ queryKey: ['sub_accounts'] })
          await qc.invalidateQueries({ queryKey: ['recurring_transactions'] })
          await qc.invalidateQueries({ queryKey: ['certificate_payouts'] })
        }
        await qc.invalidateQueries({ queryKey: ['net_worth_snapshots'] })
        sessionStorage.setItem(key, '1')
      } catch {
        /* offline or not yet configured */
      }
    }
    void run()
  }, [qc, session])
}
