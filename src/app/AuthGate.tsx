import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isConfigured } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (!isConfigured) return <Navigate to="/login" replace />
  if (loading)
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
