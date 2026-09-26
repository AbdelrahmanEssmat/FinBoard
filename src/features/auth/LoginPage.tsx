import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { supabase, isConfigured } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button, Field, Input } from '@/components/ui'

export default function LoginPage() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
        if (error) throw error
        setMsg('Check your email for the sign-in link.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          // First run: offer to create the account with these credentials
          if (/invalid login credentials/i.test(error.message)) {
            const { error: signUpError, data } = await supabase.auth.signUp({ email, password })
            if (signUpError) throw signUpError
            if (!data.session) setMsg('Account created. Confirm the email we sent you, then sign in.')
          } else throw error
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent text-white shadow-lg shadow-accent/30">
            <Wallet className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">FinBoard</h1>
          <p className="mt-1 text-sm text-muted">Your money, on every device.</p>
        </div>

        {!isConfigured ? (
          <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning">
            The app is not connected to Supabase yet. Add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> to your environment and rebuild.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-3xl bg-surface p-5 shadow-[var(--shadow-card)]">
            <Field label="Email">
              <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            {mode === 'password' ? (
              <Field label="Password">
                <Input type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
            ) : null}
            {err ? <p className="text-sm text-negative">{err}</p> : null}
            {msg ? <p className="text-sm text-positive">{msg}</p> : null}
            <Button type="submit" full size="lg" loading={busy}>
              {mode === 'password' ? 'Sign in' : 'Email me a link'}
            </Button>
            <button type="button" onClick={() => setMode(mode === 'password' ? 'magic' : 'password')} className="block w-full text-center text-sm text-muted hover:text-text">
              {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-xs text-faint">First time? Enter your email and a new password and the account will be created.</p>
      </div>
    </div>
  )
}
