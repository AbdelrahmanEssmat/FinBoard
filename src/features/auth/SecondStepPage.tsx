import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui'
import { Brand } from '@/components/shared'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { verifyCode } from '@/features/auth/stepUp'
import { toast } from '@/store/toasts'

/**
 * Shown instead of the app while the second sign-in step is owed: after a password sign-in, or on a
 * device that was already signed in when the step was turned on from another one.
 */
export function SecondStepPage() {
  const { session } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const digits = code.replace(/\D/g, '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (digits.length !== 6) return setErr('Enter the 6 digits shown in your authenticator app.')
    setBusy(true)
    setErr(null)
    try {
      await verifyCode(supabase, digits)
      toast.success('Signed in')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That code didn’t work. Try again.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-app items-center justify-center bg-bg px-6 py-10 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <Brand variant="stacked" className="mb-9" />
        <form onSubmit={submit} className="space-y-5 rounded-3xl bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Enter your sign-in code</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">Open your authenticator app and type the 6-digit code for FinBoard.</p>
            </div>
          </div>
          <Field label="Code" error={err ?? undefined}>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              placeholder="123 456"
              className="tnum text-center text-xl tracking-[0.3em]"
              aria-invalid={Boolean(err)}
            />
          </Field>
          <Button type="submit" full size="lg" loading={busy} disabled={digits.length !== 6}>
            Continue
          </Button>
          <p className="text-center text-xs leading-relaxed text-faint">
            Signed in as <span className="break-all">{session?.user.email}</span> ·{' '}
            <button type="button" className="font-medium text-accent" onClick={() => void supabase.auth.signOut({ scope: 'local' })}>
              Sign out
            </button>
          </p>
          <p className="text-center text-xs leading-relaxed text-faint">Lost the phone with your authenticator app? Ask the person who runs this FinBoard to switch the second step off for you.</p>
        </form>
      </div>
    </div>
  )
}
