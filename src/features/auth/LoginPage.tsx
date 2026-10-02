import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase, isConfigured } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button, Field, Input, Segmented } from '@/components/ui'
import { Brand } from '@/components/shared'
import { toast } from '@/store/toasts'
import { authMessage } from './authErrors'
import { isStrongPassword, newPasswordProblem } from './password'
import { PasswordChecklist, PasswordInput } from './PasswordFields'
import { markUnlocked } from '@/features/security/appLock'

type Mode = 'signin' | 'signup' | 'reset'

/**
 * Where Supabase sends people after an email link when the default email templates are in use
 * (the FinBoard templates link straight to /auth/confirm instead).
 */
const appUrl = () => window.location.origin

/** Shown after an email went out: what to do next, without saying whether the address has an account. */
interface Sent {
  kind: 'signup' | 'reset'
  email: string
}

export default function LoginPage() {
  const { session } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)
  const [resent, setResent] = useState(false)

  // back from an email link that failed (expired, already used): Supabase puts the reason in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
    const code = params.get('error_code')
    const reason = params.get('error_description')
    if (code || reason) {
      setErr(authMessage({ code: code ?? undefined, message: reason ?? undefined }))
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  if (session) return <Navigate to="/" replace />

  const cleanEmail = email.trim().toLowerCase()

  const switchMode = (m: Mode) => {
    setMode(m)
    setErr(null)
    setUnconfirmed(false)
    setSent(null)
    setConfirm('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setUnconfirmed(false)
    if (mode === 'signup') {
      const problem = newPasswordProblem(password, confirm)
      if (problem) return setErr(problem)
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (error) {
          setUnconfirmed(error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message))
          throw error
        }
        // the password was just typed: the app lock doesn't need to ask again right away
        markUnlocked()
        // accounts made before the stronger password rules: suggest an update
        if (data.weakPassword || !isStrongPassword(password)) toast.info('Tip: your password is weaker than the current rules. Change it in Settings.')
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: appUrl() } })
        if (error) throw error
        // no session = the email must be confirmed first. (Supabase answers the same way whether or
        // not the address already has an account, so nobody can probe which emails are registered.)
        if (!data.session) {
          setSent({ kind: 'signup', email: cleanEmail })
          setPassword('')
          setConfirm('')
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${appUrl()}/reset-password` })
        if (error) throw error
        setSent({ kind: 'reset', email: cleanEmail })
      }
    } catch (e) {
      setErr(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    const to = sent?.email ?? cleanEmail
    if (!to) return
    setBusy(true)
    setErr(null)
    try {
      const { error } =
        sent?.kind === 'reset'
          ? await supabase.auth.resetPasswordForEmail(to, { redirectTo: `${appUrl()}/reset-password` })
          : await supabase.auth.resend({ type: 'signup', email: to, options: { emailRedirectTo: appUrl() } })
      if (error) throw error
      if (!sent) setSent({ kind: 'signup', email: to })
      setResent(true)
      setUnconfirmed(false)
    } catch (e) {
      setErr(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-app items-center justify-center bg-bg px-6 py-10 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <h1 className="sr-only">FinBoard</h1>
        <Brand variant="stacked" className="mb-9" />

        {!isConfigured ? (
          <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning">
            The app is not connected to Supabase yet. Add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> to your environment and rebuild.
          </div>
        ) : sent ? (
          <div className="space-y-4 rounded-3xl bg-surface p-5 text-center shadow-[var(--shadow-card)]" role="status">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <MailCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Check your email</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {sent.kind === 'signup' ? (
                  <>
                    We sent a link to <span className="break-all font-medium text-text">{sent.email}</span>. Open it to confirm your email and finish creating your account.
                  </>
                ) : (
                  <>
                    If <span className="break-all font-medium text-text">{sent.email}</span> has a FinBoard account, we sent it a link to choose a new password.
                  </>
                )}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-faint">
              The link works once and expires in 1 hour. Nothing arrived? Check spam or promotions.
              {sent.kind === 'signup' ? ' Already have an account? Sign in or reset your password instead.' : ''}
            </p>
            {err ? <p className="text-sm text-negative">{err}</p> : null}
            {resent ? <p className="text-sm text-positive">Sent again. It can take a minute to arrive.</p> : null}
            <Button full variant="secondary" loading={busy} disabled={resent} onClick={() => void resend()}>
              Send the email again
            </Button>
            <button type="button" onClick={() => { setResent(false); switchMode('signin') }} className="block w-full text-center text-sm text-muted hover:text-text">
              Back to sign in
            </button>
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
                <h2 className="text-base font-semibold">Forgot your password?</h2>
                <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new one.</p>
              </div>
            )}
            <Field label="Email">
              <Input type="email" autoComplete={mode === 'signup' ? 'email' : 'username'} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            {mode === 'signin' ? (
              <Field label="Password">
                <PasswordInput autoComplete="current-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            ) : null}
            {mode === 'signup' ? (
              <>
                <div>
                  <Field label="Password">
                    <PasswordInput autoComplete="new-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <PasswordChecklist password={password} />
                </div>
                <Field label="Confirm password" error={!err && confirm && confirm !== password && confirm.length >= password.length ? 'The passwords don’t match' : undefined}>
                  <PasswordInput autoComplete="new-password" required maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
              </>
            ) : null}
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
            <Button type="submit" full size="lg" loading={busy}>
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create my account' : 'Send reset link'}
            </Button>
            {unconfirmed ? (
              <button type="button" onClick={() => void resend()} disabled={busy} className="block w-full text-center text-sm font-medium text-accent">
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
        <p className="mt-6 text-center text-xs leading-relaxed text-faint">Each person has their own private FinBoard. Your accounts and numbers are only ever visible to you.</p>
      </div>
    </div>
  )
}
