import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { KeyRound, MailCheck, UserPlus } from 'lucide-react'
import { supabase } from '@/api/supabase'
import { Button } from '@/components/ui'
import { Brand } from '@/components/shared'
import { toast } from '@/store/toasts'
import { authMessage } from './authErrors'

const TYPES: EmailOtpType[] = ['email', 'signup', 'recovery', 'invite', 'magiclink', 'email_change']

const COPY: Record<EmailOtpType, { title: string; text: string; button: string; icon: typeof MailCheck }> = {
  email: { title: 'Confirm your email', text: 'One tap and your FinBoard account is ready.', button: 'Confirm my email', icon: MailCheck },
  signup: { title: 'Confirm your email', text: 'One tap and your FinBoard account is ready.', button: 'Confirm my email', icon: MailCheck },
  magiclink: { title: 'Sign in to FinBoard', text: 'Tap below to finish signing in on this device.', button: 'Sign in', icon: MailCheck },
  recovery: { title: 'Reset your password', text: 'Tap below, then choose a new password.', button: 'Continue', icon: KeyRound },
  invite: { title: 'You’re invited to FinBoard', text: 'Tap below, then choose a password for your account.', button: 'Accept invitation', icon: UserPlus },
  email_change: { title: 'Confirm your new email', text: 'Tap below to start using this address for FinBoard.', button: 'Confirm new email', icon: MailCheck },
}

/**
 * Where the FinBoard email templates link to: /auth/confirm?token_hash=…&type=…
 * The link is only used when the person taps the button, so mail scanners that open links ahead of
 * time can't use it up. Works on any device (nothing needs to be stored from the sign-up browser).
 */
export default function ConfirmPage() {
  const navigate = useNavigate()
  const [params] = useState(() => new URLSearchParams(window.location.search))
  const tokenHash = params.get('token_hash')
  const rawType = params.get('type') as EmailOtpType | null
  const type = rawType && TYPES.includes(rawType) ? rawType : null
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const confirm = async () => {
    if (!tokenHash || !type) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    setBusy(false)
    if (error) return setErr(authMessage(error))
    if (type === 'recovery' || type === 'invite') return navigate('/reset-password', { replace: true, state: { fromEmail: true } })
    toast.success(type === 'email_change' ? 'Your new email is confirmed.' : type === 'magiclink' ? 'Signed in.' : 'Email confirmed. Welcome to FinBoard!')
    navigate('/', { replace: true })
  }

  const copy = type ? COPY[type] : null
  const Icon = copy?.icon ?? MailCheck

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 py-10 pt-safe pb-safe">
      <div className="anim-fade-up w-full max-w-sm">
        <Brand variant="stacked" className="mb-9" />
        <div className="space-y-4 rounded-3xl bg-surface p-5 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Icon className="h-6 w-6" />
          </div>
          {!copy || !tokenHash ? (
            <>
              <div>
                <h2 className="text-lg font-semibold">This link is incomplete</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">Open the link straight from the email, or ask for a new one from the sign-in page.</p>
              </div>
              <Button full onClick={() => navigate('/login', { replace: true })}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold">{copy.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{copy.text}</p>
              </div>
              {err ? (
                <p className="text-sm text-negative" role="alert">
                  {err}
                </p>
              ) : null}
              {err ? (
                <Button full variant="secondary" onClick={() => navigate('/login', { replace: true })}>
                  Go to sign in to get a new link
                </Button>
              ) : (
                <Button full size="lg" loading={busy} onClick={() => void confirm()}>
                  {copy.button}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
