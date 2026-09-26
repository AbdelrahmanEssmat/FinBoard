import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from 'react-router-dom'
import { idbPersister, queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/lib/auth'
import { Toaster } from '@/components/ui'
import { router } from './router'

export function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: idbPersister, maxAge: 1000 * 60 * 60 * 24 * 14, buster: 'v1' }}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </PersistQueryClientProvider>
  )
}
