import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Fingerprint, Lock } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { Brand } from '@/components/shared'
import { supabase } from '@/api/supabase'
import { useUserId } from '@/app/providers/AuthProvider'
import { toast } from '@/store/toasts'
import { checkPin, forgetUnlocked, markUnlocked, useAppLock, verifyBiometric, wasUnlockedThisRun } from '@/features/security/appLock'

const HIDDEN_AT_KEY = 'finboard-hidden-at'
const MAX_TRIES = 5

function storedHiddenAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(HIDDEN_AT_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function storeHiddenAt(v: number | null) {
  try {
    if (v === null) sessionStorage.removeItem(HIDDEN_AT_KEY)
    else sessionStorage.setItem(HIDDEN_AT_KEY, String(v))
  } catch {
    /* private mode */
  }
}

/**
 * Covers the app while it is locked: when it starts (unless you just signed in with your password)
 * and when you come back after the chosen time away. While FinBoard is in the background it is
 * covered too, so the app switcher doesn't show your numbers.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const userId = useUserId()
  const lock = useAppLock()
  const enabled = lock.method !== 'none' && Boolean(userId) && lock.userId === userId
  const [locked, setLocked] = useState(() => {
    if (!enabled) return false
    const hiddenAt = storedHiddenAt()
    return !wasUnlockedThisRun() || (hiddenAt !== null && Date.now() - hiddenAt >= lock.after * 1000)
  })
  const [covered, setCovered] = useState(false)

  const lockNow = useCallback(() => {
    forgetUnlocked()
    setLocked(true)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLocked(false)
      setCovered(false)
      return
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        storeHiddenAt(Date.now())
        if (lock.after === 0) lockNow()
        else setCovered(true)
      } else {
        const hiddenAt = storedHiddenAt()
        storeHiddenAt(null)
        setCovered(false)
        if (hiddenAt !== null && Date.now() - hiddenAt >= lock.after * 1000) lockNow()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, lock.after, lockNow])

  const unlock = () => {
    markUnlocked()
    storeHiddenAt(null)
    setLocked(false)
  }

  return (
    <>
      {children}
      {enabled && locked ? <LockScreen onUnlock={unlock} /> : enabled && covered ? <Cover /> : null}
    </>
  )
}

function Cover() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-bg" aria-hidden>
      <Brand variant="stacked" />
    </div>
  )
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const lock = useAppLock()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tries = useRef(0)
  const triedBiometric = useRef(false)

  const tryBiometric = useCallback(async () => {
    if (!lock.credentialId) return
    setBusy(true)
    setErr(null)
    const ok = await verifyBiometric(lock.credentialId)
    setBusy(false)
    if (ok) onUnlock()
    else setErr('Not recognised. Try again, or use your password.')
  }, [lock.credentialId, onUnlock])

  // ask for Face ID straight away where the device allows it without a tap (desktops, most phones)
  useEffect(() => {
    if (lock.method === 'biometric' && !triedBiometric.current) {
      triedBiometric.current = true
      void tryBiometric()
    }
  }, [lock.method, tryBiometric])

  const submitPin = async (e: FormEvent) => {
    e.preventDefault()
    if (!pin) return
    setBusy(true)
    const ok = await checkPin(pin, lock.pinHash, lock.pinSalt)
    setBusy(false)
    if (ok) return onUnlock()
    tries.current++
    setPin('')
    if (tries.current >= MAX_TRIES) {
      toast.error('Too many wrong PINs. Sign in with your password.')
      void supabase.auth.signOut({ scope: 'local' })
      return
    }
    setErr(`Wrong PIN. ${MAX_TRIES - tries.current} ${MAX_TRIES - tries.current === 1 ? 'try' : 'tries'} left.`)
  }

  const usePassword = () => void supabase.auth.signOut({ scope: 'local' })

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-bg px-6 py-10 pt-safe pb-safe" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="anim-fade-up w-full max-w-xs text-center">
        <Brand variant="stacked" className="mb-8" />
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Lock className="h-5 w-5" />
        </span>
        <h2 id="lock-title" className="mt-3 text-lg font-semibold">
          FinBoard is locked
        </h2>
        {lock.method === 'biometric' ? (
          <div className="mt-6 space-y-3">
            <Button full size="lg" onClick={() => void tryBiometric()} loading={busy}>
              <Fingerprint className="h-5 w-5" /> Unlock
            </Button>
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submitPin} className="mt-6 space-y-3">
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="PIN"
              placeholder="PIN"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="tnum text-center text-xl tracking-[0.4em]"
            />
            <Button type="submit" full size="lg" loading={busy} disabled={pin.length < 4}>
              Unlock
            </Button>
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
          </form>
        )}
        <button type="button" onClick={usePassword} className="mt-6 min-h-11 text-sm font-medium text-accent">
          Use my password instead
        </button>
      </div>
    </div>
  )
}
