import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/api/supabase'
import { queryClient } from '@/api/queryClient'
import { idbPersister } from '@/offline/persister'
import { getCurrentUserId, getDeviceDataOwner, setCurrentUserId, setDeviceDataOwner } from '@/offline/session'
import { stampUnowned } from '@/offline/outbox'
import { usePrefs } from '@/store/prefs'

interface AuthState {
  session: Session | null
  loading: boolean
  /** signed in through a password-reset link: the new password must be set first */
  recovery: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, recovery: false })

/**
 * Forget everything the previous person left on this device: the saved copy of their data and
 * their "last used" picks. (Their queued offline changes stay, stamped with their user, and are
 * sent the next time they sign in here.)
 */
function forgetDeviceData() {
  queryClient.clear()
  void idbPersister.removeClient()
  usePrefs.getState().remember({ lastSubAccountId: null, lastCurrency: null, lastExpenseCategoryId: null, lastIncomeCategoryId: null })
}

/** Called whenever the signed-in user is known (or changes). */
function adoptUser(userId: string | null) {
  setCurrentUserId(userId)
  if (!userId) return
  const owner = getDeviceDataOwner()
  if (owner && owner !== userId) forgetDeviceData() // someone else's data is saved here
  setDeviceDataOwner(userId)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, recovery: false })

  useEffect(() => {
    let mounted = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return
        adoptUser(data.session?.user.id ?? null)
        setState((s) => ({ ...s, session: data.session, loading: false }))
      })
      .catch(() => mounted && setState((s) => ({ ...s, session: null, loading: false })))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        // older unstamped offline changes belong to the person signing out, not the next one
        const leaving = getCurrentUserId() ?? getDeviceDataOwner()
        if (leaving) void stampUnowned(leaving)
        forgetDeviceData()
        setDeviceDataOwner(null)
      }
      adoptUser(session?.user.id ?? null)
      setState((s) => ({
        session,
        loading: false,
        recovery: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' || event === 'USER_UPDATED' ? false : s.recovery,
      }))
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function useUserId(): string | null {
  return useAuth().session?.user.id ?? null
}
