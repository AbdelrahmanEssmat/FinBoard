import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button, Field } from '@/components/ui'
import { Brand } from '@/components/shared'
import { toast } from '@/store/toasts'
import { authMessage } from './authErrors'
import { newPasswordProblem } from './password'
import { PasswordChecklist, PasswordInput } from './PasswordFields'

/** Reached from the "reset password" email: the link signs you in, then you choose a new password. */
export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = newPasswordProblem(password, confirm)
    if (problem) return setErr(problem)
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      return setErr(authMessage(error))
    }
    // anyone else signed in with the old password (other phones, a stolen session) is signed out
    await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
    setBusy(false)
    toast.success('Your new password is saved.')
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-app items-center justify-center bg-bg px-6 py-10 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <Brand variant="stacked" className="mb-9" />
        {loading ? (
          <div className="flex justify-center text-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !session ? (
          <div className="space-y-4 rounded-3xl bg-surface p-5 text-sm shadow-[var(--shadow-card)]">
            <p className="text-muted">This reset link has expired or was already used. Ask for a new one from the sign-in page.</p>
            <Button full onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-3xl bg-surface p-5 shadow-[var(--shadow-card)]">
            <div>
              <h2 className="text-base font-semibold">Choose a new password</h2>
              <p className="mt-1 break-all text-sm text-muted">For {session.user.email}</p>
            </div>
            {/* lets password managers save the new password against the right account */}
            <input type="email" autoComplete="username" value={session.user.email ?? ''} readOnly hidden />
            <div>
              <Field label="New password">
                <PasswordInput autoComplete="new-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <PasswordChecklist password={password} />
            </div>
            <Field label="Confirm new password" error={!err && confirm && confirm !== password && confirm.length >= password.length ? 'The passwords don’t match' : undefined}>
              <PasswordInput autoComplete="new-password" required maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
            <Button type="submit" full size="lg" loading={busy}>
              Save new password
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
