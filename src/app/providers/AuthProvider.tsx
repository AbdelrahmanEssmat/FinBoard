import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/api/supabase'
import { queryClient } from '@/api/queryClient'
import { idbPersister } from '@/offline/persister'
import { getCurrentUserId, getDeviceDataOwner, setCurrentUserId, setDeviceDataOwner, setSendingPaused } from '@/offline/session'
import { hasSecondStep, sessionLevel } from '@/features/auth/stepUp'
import { stampUnowned } from '@/offline/outbox'
import { usePrefs } from '@/store/prefs'

interface AuthState {
  session: Session | null
  loading: boolean
  /** signed in through a password-reset link: the new password must be set first */
  recovery: boolean
  /** signed in with the password, but the second step (authenticator code) is still owed */
  mfaPending: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, recovery: false, mfaPending: false })

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
  const [state, setState] = useState<AuthState>({ session: null, loading: true, recovery: false, mfaPending: false })
  // from the server: the second step may have been turned on from another device since this session began
  const [secondStepOn, setSecondStepOn] = useState<boolean | null>(null)

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
        ...s,
        session,
        loading: false,
        recovery: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' || event === 'USER_UPDATED' ? false : s.recovery,
      }))
      if (event === 'SIGNED_OUT') setSecondStepOn(null)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // ask the server whether the second step is on: when the session starts and whenever the app comes back
  const userId = state.session?.user.id ?? null
  useEffect(() => {
    if (!userId) return
    let last = 0
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30_000 || !navigator.onLine) return
      last = Date.now()
      const { data, error } = await supabase.auth.getUser()
      if (!error && data.user) setSecondStepOn(Boolean(data.user.factors?.some((f) => f.factor_type === 'totp' && f.status === 'verified')))
    }
    void check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [userId])

  const mfaPending = Boolean(state.session) && (secondStepOn ?? hasSecondStep(state.session)) && sessionLevel(state.session) !== 'aal2'
  // nothing queued offline is sent until the code is entered (the server would refuse and the change be lost);
  // once it is, everything is reloaded (the screens showed nothing while the step was owed)
  const wasPending = useRef(false)
  useEffect(() => {
    setSendingPaused(mfaPending)
    if (wasPending.current && !mfaPending) void queryClient.invalidateQueries()
    wasPending.current = mfaPending
  }, [mfaPending])

  const value = useMemo(() => ({ ...state, mfaPending }), [state, mfaPending])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function useUserId(): string | null {
  return useAuth().session?.user.id ?? null
}
