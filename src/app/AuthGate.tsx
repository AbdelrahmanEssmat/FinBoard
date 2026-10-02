import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/app/providers/AuthProvider'
import { isConfigured } from '@/api/supabase'
import { Loader2 } from 'lucide-react'
import { SecondStepPage } from '@/features/auth/SecondStepPage'
import { AppLockGate } from '@/features/security/AppLockGate'

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading, recovery, mfaPending } = useAuth()
  if (!isConfigured) return <Navigate to="/login" replace />
  if (loading)
    return (
      <div className="flex min-h-app items-center justify-center text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  if (!session) return <Navigate to="/login" replace />
  // signed in from a password-reset email: set the new password before anything else
  if (recovery) return <Navigate to="/reset-password" replace />
  // the second sign-in step is on and this session hasn't passed it yet: nothing else is shown
  if (mfaPending) return <SecondStepPage />
  return <AppLockGate>{children}</AppLockGate>
}
