import { useState, type FormEvent } from 'react'
import { KeyRound, LogOut, MonitorSmartphone, UserRound } from 'lucide-react'
import { Button, Card, Divider, Field, FormStack, Sheet } from '@/components/ui'
import { ListRow, SectionTitle } from '@/components/shared'
import { supabase } from '@/api/supabase'
import { useAuth } from '@/app/providers/AuthProvider'
import { toast } from '@/store/toasts'
import { authMessage } from '@/features/auth/authErrors'
import { newPasswordProblem } from '@/features/auth/password'
import { PasswordChecklist, PasswordInput } from '@/features/auth/PasswordFields'
import { useSignOut } from '@/features/auth/useSignOut'

/** Settings → Account: who's signed in, change password, sign out here or everywhere. */
export function AccountSection() {
  const { session } = useAuth()
  const [changing, setChanging] = useState(false)
  const { askSignOut, dialog: signOutDialog } = useSignOut()

  return (
    <section>
      <SectionTitle>Account</SectionTitle>
      <Card className="overflow-hidden">
        <ListRow icon={UserRound} color="#6366f1" title="Signed in as" subtitle={<span className="break-all">{session?.user.email}</span>} />
        <Divider />
        <ListRow icon={KeyRound} color="#0d9488" title="Change password" chevron onClick={() => setChanging(true)} />
        <Divider />
        <ListRow icon={LogOut} color="#dc2626" title="Sign out" subtitle="On this device" onClick={() => void askSignOut('local')} />
        <Divider />
        <ListRow icon={MonitorSmartphone} color="#dc2626" title="Sign out everywhere" subtitle="On all your devices" onClick={() => void askSignOut('global')} />
      </Card>

      <ChangePasswordSheet open={changing} onClose={() => setChanging(false)} email={session?.user.email ?? ''} />
      {signOutDialog}
    </section>
  )
}

function ChangePasswordSheet({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const close = () => {
    setCurrent('')
    setPassword('')
    setConfirm('')
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
      // prove it's really you (someone holding an unlocked phone can't change it), and get a fresh session
      const check = await supabase.auth.signInWithPassword({ email, password: current })
      if (check.error) throw check.error.code === 'invalid_credentials' || /invalid login/i.test(check.error.message) ? new Error('Your current password is wrong.') : check.error
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // other devices still signed in with the old password are signed out
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
      toast.success('Password changed. Other devices were signed out.')
      close()
    } catch (e) {
      setErr(e instanceof Error && e.message === 'Your current password is wrong.' ? e.message : authMessage(e))
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
