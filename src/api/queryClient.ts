import { QueryClient } from '@tanstack/react-query'

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
