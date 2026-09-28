import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, isConfigured } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button, Field, Input, Segmented } from '@/components/ui'
import { Brand } from '@/components/shared'

type Mode = 'signin' | 'signup' | 'reset'

/** Where Supabase sends people back after they click a link in an email (confirm, reset). */
const appUrl = () => window.location.origin

/** Supabase's messages, in plain words. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password. New here? Choose “Create account”.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you (check spam too).'
  if (/already registered|already exists/i.test(message)) return 'There is already an account with this email. Sign in instead, or reset the password.'
  if (/rate limit|too many/i.test(message)) return 'Too many emails were sent just now. Please try again in a little while.'
  if (/password should be at least/i.test(message)) return 'Use a password of at least 6 characters.'
  if (/otp_expired|expired|invalid.*(link|token)/i.test(message)) return 'That email link has expired or was already used. Ask for a new one below.'
  return message
}

export default function LoginPage() {
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [canResend, setCanResend] = useState(false)

  // coming back from an email link that failed (e.g. expired): Supabase puts the reason in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
    const reason = params.get('error_description') ?? params.get('error_code')
    if (reason) {
      setErr(friendly(`${params.get('error_code') ?? ''} ${reason}`))
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  if (session) return <Navigate to="/" replace />

  const switchMode = (m: Mode) => {
    setMode(m)
    setErr(null)
    setMsg(null)
    setCanResend(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    setCanResend(false)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) {
          setCanResend(/email not confirmed/i.test(error.message))
          throw error
        }
      } else if (mode === 'signup') {
        if (password !== confirm) throw new Error('The two passwords are different.')
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl() } })
        if (error) throw error
        // Supabase answers a sign-up for an existing (confirmed) email with a user that has no identities
        if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('User already registered')
        if (!data.session) {
          setMsg(`Almost done: we sent a link to ${email.trim()}. Open it to confirm your email, then sign in here.`)
          setCanResend(true)
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appUrl()}/reset-password` })
        if (error) throw error
        setMsg(`If ${email.trim()} has an account, a link to set a new password is on its way.`)
      }
    } catch (e) {
      setErr(friendly(e instanceof Error ? e.message : 'Something went wrong'))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appUrl() } })
      if (error) throw error
      setMsg(`A new confirmation link was sent to ${email.trim()}.`)
      setCanResend(false)
    } catch (e) {
      setErr(friendly(e instanceof Error ? e.message : 'Could not send the email'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <h1 className="sr-only">FinBoard</h1>
        <Brand variant="stacked" className="mb-9" />

        {!isConfigured ? (
          <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning">
            The app is not connected to Supabase yet. Add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> to your environment and rebuild.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-3xl bg-surface p-5 shadow-[var(--shadow-card)]">
            {mode !== 'reset' ? (
              <Segmented
                value={mode}
                onChange={switchMode}
                options={[
                  { value: 'signin', label: 'Sign in' },
                  { value: 'signup', label: 'Create account' },
                ]}
              />
            ) : (
              <div>
                <h2 className="text-base font-semibold">Reset your password</h2>
                <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a link to set a new one.</p>
              </div>
            )}
            <Field label="Email">
              <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            {mode !== 'reset' ? (
              <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters' : undefined}>
                <Input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
            ) : null}
            {mode === 'signup' ? (
              <Field label="Password again">
                <Input type="password" autoComplete="new-password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
              </Field>
            ) : null}
            {err ? <p className="text-sm text-negative">{err}</p> : null}
            {msg ? <p className="text-sm text-positive">{msg}</p> : null}
            <Button type="submit" full size="lg" loading={busy}>
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create my account' : 'Send reset link'}
            </Button>
            {canResend && email ? (
              <button type="button" onClick={resend} disabled={busy} className="block w-full text-center text-sm font-medium text-accent">
                Resend the confirmation email
              </button>
            ) : null}
            {mode === 'signin' ? (
              <button type="button" onClick={() => switchMode('reset')} className="block w-full text-center text-sm text-muted hover:text-text">
                Forgot your password?
              </button>
            ) : mode === 'reset' ? (
              <button type="button" onClick={() => switchMode('signin')} className="block w-full text-center text-sm text-muted hover:text-text">
                Back to sign in
              </button>
            ) : null}
          </form>
        )}
        <p className="mt-6 text-center text-xs leading-relaxed text-faint">Each person has their own private FinBoard: your accounts and numbers are only ever visible to you.</p>
      </div>
    </div>
  )
}
