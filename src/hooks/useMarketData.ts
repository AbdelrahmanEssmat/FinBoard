import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { refreshRatesFromClient } from '@/api/ratesProvider'
import { refreshGoldPrices } from '@/api/goldProvider'
import { useAuth } from '@/app/providers/AuthProvider'

const EVERY_MS = 30 * 60_000
/** Coming back to the app re-checks at most this often. */
const ON_RETURN_MIN_GAP_MS = 5 * 60_000

/**
 * Keeps exchange rates and gold prices current while the app is used: on open, every 30 minutes
 * while it stays open, and when it comes back to the foreground (an installed app on a phone can
 * sit in the background for days). Each refresh only does work when its data is actually stale.
 */
export function useMarketData() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const running = useRef(false)
  const lastRun = useRef(0)

  useEffect(() => {
    const userId = session?.user.id ?? null
    if (!userId) return

    const run = async () => {
      if (running.current || !navigator.onLine) return
      running.current = true
      lastRun.current = Date.now()
      try {
        const [rates, gold] = await Promise.allSettled([
          (async () => {
            const { data: currencies } = await supabase.from('currencies').select('code').eq('is_active', true)
            return refreshRatesFromClient((currencies ?? []).map((c) => c.code), userId)
          })(),
          refreshGoldPrices(userId),
        ])
        if (rates.status === 'fulfilled' && rates.value > 0) await qc.invalidateQueries({ queryKey: ['exchange_rates'] })
        if (gold.status === 'fulfilled' && gold.value.status === 'saved') await qc.invalidateQueries({ queryKey: ['gold_prices'] })
      } finally {
        running.current = false
      }
    }

    void run()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void run(), EVERY_MS)
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.current > ON_RETURN_MIN_GAP_MS) void run()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('online', onReturn)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('online', onReturn)
    }
  }, [qc, session?.user.id])
}
