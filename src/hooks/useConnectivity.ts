import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { flushOutbox } from '@/offline/mutate'
import { onOutboxChange, pendingCount } from '@/offline/outbox'
import { useAuth } from '@/app/providers/AuthProvider'

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
