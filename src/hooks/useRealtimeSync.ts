import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, isLocalStack } from '@/api/supabase'
import { ALL_TABLES } from '@/api/queries'
import { useAuth } from '@/app/providers/AuthProvider'

/** Realtime subscription: any change in my rows refreshes the matching query, so other devices stay in step. */
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
