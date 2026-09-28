import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { Button, Field, Input } from '@/components/ui'
import { Brand } from '@/components/shared'

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
    if (password !== confirm) return setErr('The two passwords are different.')
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setErr(/at least/i.test(error.message) ? 'Use a password of at least 6 characters.' : error.message)
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <Brand variant="stacked" className="mb-9" />
        {loading ? (
          <div className="flex justify-center text-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !session ? (
          <div className="space-y-4 rounded-3xl bg-surface p-5 text-sm shadow-[var(--shadow-card)]">
            <p className="text-muted">This reset link has expired or was already used.</p>
            <Button full onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-3xl bg-surface p-5 shadow-[var(--shadow-card)]">
            <div>
              <h2 className="text-base font-semibold">Choose a new password</h2>
              <p className="mt-1 text-sm text-muted">For {session.user.email}</p>
            </div>
            <Field label="New password" hint="At least 6 characters">
              <Input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="New password again">
              <Input type="password" autoComplete="new-password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {err ? <p className="text-sm text-negative">{err}</p> : null}
            <Button type="submit" full size="lg" loading={busy}>
              Save new password
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
