import { useEffect, useState, type FormEvent } from 'react'
import { AtSign, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Card, Divider, Field, FormStack, Input, Segmented, Sheet } from '@/components/ui'
import { ListRow, SectionTitle } from '@/components/shared'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { toast } from '@/store/toasts'
import { authMessage } from '@/features/auth/authErrors'
import { newPasswordProblem } from '@/features/auth/password'
import { PasswordChecklist, PasswordInput } from '@/features/auth/PasswordFields'
import { CodeNeededError, hasSecondStep, stepUp } from '@/features/auth/stepUp'
import { biometricAvailable, hashPin, PIN_RE, registerBiometric, useAppLock, type LockMethod } from '@/features/security/appLock'

export const errorText = (e: unknown) => (e instanceof Error && (e instanceof CodeNeededError || /password is wrong|code isn/i.test(e.message)) ? e.message : authMessage(e))

/** The 6-digit code field shown in sensitive sheets when the second step is on. */
export function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Code from your authenticator app">
      <Input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
        placeholder="123 456"
        className="tnum tracking-[0.2em]"
      />
    </Field>
  )
}

/** Settings → Security: second sign-in step, app lock, password and email. */
export function SecuritySection() {
  const { session } = useAuth()
  const email = session?.user.email ?? ''
  const twoStep = hasSecondStep(session)
  const lock = useAppLock()
  const lockOn = lock.method !== 'none' && lock.userId === session?.user.id
  const [open, setOpen] = useState<'twoStep' | 'lock' | 'password' | 'email' | null>(null)
  const close = () => setOpen(null)

  return (
    <section>
      <SectionTitle>Security</SectionTitle>
      <Card className="overflow-hidden">
        <ListRow
          icon={ShieldCheck}
          color="#16a34a"
          title="Two-step sign-in"
          subtitle={twoStep ? 'On: a code from your authenticator app is needed to sign in' : 'Off: add a code from an authenticator app'}
          chevron
          onClick={() => setOpen('twoStep')}
        />
        <Divider />
        <ListRow
          icon={Fingerprint}
          color="#7c3aed"
          title="App lock"
          subtitle={lockOn ? (lock.method === 'biometric' ? 'Face ID / fingerprint on this device' : 'PIN on this device') : 'Off on this device'}
          chevron
          onClick={() => setOpen('lock')}
        />
        <Divider />
        <ListRow icon={KeyRound} color="#0d9488" title="Change password" chevron onClick={() => setOpen('password')} />
        <Divider />
        <ListRow icon={AtSign} color="#2563eb" title="Change email" subtitle={<span className="break-all">{email}</span>} chevron onClick={() => setOpen('email')} />
      </Card>

      <TwoStepSheet open={open === 'twoStep'} onClose={close} email={email} on={twoStep} />
      <AppLockSheet open={open === 'lock'} onClose={close} email={email} />
      <ChangePasswordSheet open={open === 'password'} onClose={close} email={email} twoStep={twoStep} />
      <ChangeEmailSheet open={open === 'email'} onClose={close} email={email} twoStep={twoStep} />
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Two-step sign-in
// ---------------------------------------------------------------------------------------------

function TwoStepSheet({ open, onClose, email, on }: { open: boolean; onClose: () => void; email: string; on: boolean }) {
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSetup(null)
    setCode('')
    setPassword('')
    setErr(null)
  }, [open])

  const start = async () => {
    setBusy(true)
    setErr(null)
    try {
      // an abandoned earlier attempt would block a new one
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of list?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`, issuer: 'FinBoard' })
      if (error) throw error
      setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (e) {
      setErr(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!setup) return
    setBusy(true)
    setErr(null)
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: code.replace(/\s/g, '') })
      if (error) throw new Error('That code isn’t right. Codes change every 30 seconds: try the current one.')
      await supabase.auth.refreshSession().catch(() => undefined)
      toast.success('Two-step sign-in is on')
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      // proving it's you again keeps someone holding an unlocked phone from switching it off
      const client = await stepUp(email, password, code)
      const { data: list } = await client.auth.mfa.listFactors()
      for (const f of list?.all ?? []) {
        const { error } = await client.auth.mfa.unenroll({ factorId: f.id })
        if (error) throw error
      }
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
      await supabase.auth.refreshSession().catch(() => undefined)
      toast.success('Two-step sign-in is off')
      onClose()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Two-step sign-in">
      {on ? (
        <form onSubmit={turnOff}>
          <FormStack>
            <p className="text-sm leading-relaxed text-muted">
              Signing in needs your password and a code from your authenticator app. To switch this off, confirm it's you.
            </p>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <Field label="Password">
              <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <CodeField value={code} onChange={setCode} />
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
            <Button type="submit" variant="danger" full size="lg" loading={busy} disabled={!password || code.replace(/\D/g, '').length !== 6}>
              Turn off two-step sign-in
            </Button>
          </FormStack>
        </form>
      ) : setup ? (
        <form onSubmit={confirm}>
          <FormStack>
            <p className="text-sm leading-relaxed text-muted">
              1. In an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, or the Passwords app on iPhone), add an account by scanning this
              code, or type the setup key.
            </p>
            <div className="flex justify-center">
              <img src={setup.qr} alt="QR code for your authenticator app" className="h-48 w-48 rounded-xl bg-white p-2" />
            </div>
            <div className="rounded-xl bg-surface-2 p-3 text-center">
              <div className="text-xs text-muted">Setup key</div>
              <div className="tnum mt-1 select-all break-all font-mono text-sm font-semibold tracking-wider">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
            </div>
            <p className="text-sm leading-relaxed text-muted">2. Type the 6-digit code it shows.</p>
            <CodeField value={code} onChange={setCode} />
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
            <Button type="submit" full size="lg" loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>
              Turn on
            </Button>
            <p className="text-xs leading-relaxed text-faint">
              Keep the setup key somewhere safe (a password manager): you can add it to a second device. Your other signed-in devices will ask for a code next time
              they open FinBoard.
            </p>
          </FormStack>
        </form>
      ) : (
        <FormStack>
          <p className="text-sm leading-relaxed text-muted">
            Even if someone learns your password, they can't open your FinBoard without the 6-digit code from the authenticator app on your phone.
          </p>
          {err ? (
            <p className="text-sm text-negative" role="alert">
              {err}
            </p>
          ) : null}
          <Button full size="lg" loading={busy} onClick={() => void start()}>
            Set up two-step sign-in
          </Button>
        </FormStack>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------------------------
// App lock (this device only)
// ---------------------------------------------------------------------------------------------

function AppLockSheet({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const { session } = useAuth()
  const lock = useAppLock()
  const userId = session?.user.id ?? null
  const current: LockMethod = lock.userId === userId ? lock.method : 'none'
  const [method, setMethod] = useState<LockMethod>(current)
  const [after, setAfter] = useState(String(lock.after))
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [canBiometric, setCanBiometric] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMethod(lock.userId === userId ? lock.method : 'none')
    setAfter(String(lock.after))
    setPin('')
    setPin2('')
    setErr(null)
    void biometricAvailable().then(setCanBiometric)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const save = async () => {
    if (!userId) return
    setErr(null)
    if (method === 'none') {
      lock.clear()
      toast.success('App lock is off on this device')
      return onClose()
    }
    if (method === 'pin') {
      if (!(current === 'pin' && !pin)) {
        if (!PIN_RE.test(pin)) return setErr('Use 4 to 8 digits.')
        if (pin !== pin2) return setErr('The two PINs don’t match.')
        const { hash, salt } = await hashPin(pin)
        lock.set({ method: 'pin', userId, pinHash: hash, pinSalt: salt, credentialId: null, after: Number(after) })
      } else lock.set({ after: Number(after) })
      toast.success('App lock is on')
      return onClose()
    }
    // Face ID / fingerprint: make the device passkey once
    if (current === 'biometric' && lock.credentialId) {
      lock.set({ after: Number(after) })
      return onClose()
    }
    setBusy(true)
    try {
      const credentialId = await registerBiometric(userId, email)
      lock.set({ method: 'biometric', userId, credentialId, pinHash: null, pinSalt: null, after: Number(after) })
      toast.success('App lock is on')
      onClose()
    } catch {
      setErr('Face ID or fingerprint couldn’t be set up here. Use a PIN instead.')
    } finally {
      setBusy(false)
    }
  }

  const options: { value: LockMethod; label: string }[] = [
    { value: 'none', label: 'Off' },
    ...(canBiometric || current === 'biometric' ? [{ value: 'biometric' as LockMethod, label: 'Face ID' }] : []),
    { value: 'pin', label: 'PIN' },
  ]

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="App lock"
      footer={
        <Button full size="lg" onClick={() => void save()} loading={busy}>
          Save
        </Button>
      }
    >
      <FormStack>
        <p className="text-sm leading-relaxed text-muted">
          Asks for Face ID, a fingerprint or a PIN when you open FinBoard on this device, so someone holding your unlocked phone can't look inside.
        </p>
        <Field label="Unlock with" group>
          <Segmented value={method} onChange={setMethod} options={options} />
        </Field>
        {method === 'pin' ? (
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
            <Field label={current === 'pin' ? 'New PIN (optional)' : 'PIN'} hint="4 to 8 digits">
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="tnum" />
            </Field>
            <Field label="PIN again">
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} className="tnum" />
            </Field>
          </div>
        ) : null}
        {method !== 'none' ? (
          <Field label="Lock again after" group>
            <Segmented
              value={after}
              onChange={setAfter}
              options={[
                { value: '0', label: 'Right away' },
                { value: '60', label: '1 minute' },
                { value: '300', label: '5 minutes' },
              ]}
            />
          </Field>
        ) : null}
        {!canBiometric && method !== 'biometric' ? <p className="text-xs leading-relaxed text-faint">Face ID or fingerprint isn't available in this browser, so a PIN is offered.</p> : null}
        {err ? (
          <p className="text-sm text-negative" role="alert">
            {err}
          </p>
        ) : null}
      </FormStack>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------------------------
// Password and email
// ---------------------------------------------------------------------------------------------

function ChangePasswordSheet({ open, onClose, email, twoStep }: { open: boolean; onClose: () => void; email: string; twoStep: boolean }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const close = () => {
    setCurrent('')
    setPassword('')
    setConfirm('')
    setCode('')
    setErr(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = newPasswordProblem(password, confirm)
    if (problem) return setErr(problem)
    if (password === current) return setErr('Your new password must be different from the current one.')
    setBusy(true)
    setErr(null)
    try {
      // prove it's really you on a separate connection (this device's session stays as it is)
      const client = await stepUp(email, current, code)
      const { error } = await client.auth.updateUser({ password })
      if (error) throw error
      // every other session (other devices, and the one just used to check) is signed out
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
      toast.success('Password changed. Other devices were signed out.')
      close()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Change password"
      footer={
        <Button type="submit" form="change-password" full size="lg" loading={busy}>
          Save new password
        </Button>
      }
    >
      <form id="change-password" onSubmit={submit}>
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <FormStack>
          <Field label="Current password">
            <PasswordInput autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          {twoStep ? <CodeField value={code} onChange={setCode} /> : null}
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
        </FormStack>
      </form>
    </Sheet>
  )
}

const EMAIL_RE = /^[^\s@'"\\;]+@[^\s@'"\\;]+\.[^\s@'"\\;]{2,}$/

function ChangeEmailSheet({ open, onClose, email, twoStep }: { open: boolean; onClose: () => void; email: string; twoStep: boolean }) {
  const [next, setNext] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNext('')
    setPassword('')
    setCode('')
    setErr(null)
    setSentTo(null)
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const target = next.trim().toLowerCase()
    if (!EMAIL_RE.test(target)) return setErr('Enter a valid email address.')
    if (target === email.toLowerCase()) return setErr('That is already your email.')
    setBusy(true)
    setErr(null)
    try {
      await stepUp(email, password, code).then((c) => c.auth.signOut({ scope: 'local' }).catch(() => undefined))
      const { error } = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: `${location.origin}/auth/confirm` })
      if (error) throw error
      setSentTo(target)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Change email">
      {sentTo ? (
        <FormStack>
          <p className="text-sm leading-relaxed text-muted">
            We sent a confirmation link to <span className="break-all font-medium text-text">{sentTo}</span>. Open it to start using the new address. For your
            safety, a link may also go to <span className="break-all font-medium text-text">{email}</span>: confirm it there too.
          </p>
          <Button full size="lg" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </FormStack>
      ) : (
        <form onSubmit={submit}>
          <FormStack>
            <Field label="New email">
              <Input type="email" inputMode="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} placeholder="you@example.com" />
            </Field>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <Field label="Your password">
              <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {twoStep ? <CodeField value={code} onChange={setCode} /> : null}
            {err ? (
              <p className="text-sm text-negative" role="alert">
                {err}
              </p>
            ) : null}
            <Button type="submit" full size="lg" loading={busy} disabled={!next.trim() || !password}>
              Send confirmation link
            </Button>
          </FormStack>
        </form>
      )}
    </Sheet>
  )
}
