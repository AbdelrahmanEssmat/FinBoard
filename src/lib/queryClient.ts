import { QueryClient } from '@tanstack/react-query'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 14,
      networkMode: 'offlineFirst',
      retry: (failureCount, error) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return false
        const msg = (error as Error)?.message ?? ''
        if (/JWT|401|403|not allowed/i.test(msg)) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
    },
    mutations: { networkMode: 'offlineFirst', retry: 0 },
  },
})

const KEY = 'finance-tracker-query-cache'
export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await set(KEY, client)
    } catch {
      /* storage unavailable (private mode) */
    }
  },
  restoreClient: async () => {
    try {
      return (await get<PersistedClient>(KEY)) ?? undefined
    } catch {
      return undefined
    }
  },
  removeClient: async () => {
    try {
      await del(KEY)
    } catch {
      /* ignore */
    }
  },
}
