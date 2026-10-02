import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, MonitorSmartphone, Trash2, UserRound } from 'lucide-react'
import { Button, Card, Divider, Field, FormStack, Sheet, Toggle } from '@/components/ui'
import { ListRow, SectionTitle } from '@/components/shared'
import { supabase } from '@/api/supabase'
import { queryClient } from '@/api/queryClient'
import { idbPersister } from '@/offline/persister'
import { clearMyEntries } from '@/offline/outbox'
import { useAuth } from '@/app/providers/AuthProvider'
import { toast } from '@/store/toasts'
import { PasswordInput } from '@/features/auth/PasswordFields'
import { hasSecondStep, stepUp } from '@/features/auth/stepUp'
import { useSignOut } from '@/features/auth/useSignOut'
import { useAppLock } from '@/features/security/appLock'
import { CodeField, errorText } from './SecuritySection'

/** Settings → Account: who's signed in, sign out here or everywhere, delete the account. */
export function AccountSection() {
  const { session } = useAuth()
  const [deleting, setDeleting] = useState(false)
  const { askSignOut, dialog: signOutDialog } = useSignOut()

  return (
    <section>
      <SectionTitle>Account</SectionTitle>
      <Card className="overflow-hidden">
        <ListRow icon={UserRound} color="#6366f1" title="Signed in as" subtitle={<span className="break-all">{session?.user.email}</span>} />
        <Divider />
        <ListRow icon={LogOut} color="#dc2626" title="Sign out" subtitle="On this device" onClick={() => void askSignOut('local')} />
        <Divider />
        <ListRow icon={MonitorSmartphone} color="#dc2626" title="Sign out everywhere" subtitle="On all your devices" onClick={() => void askSignOut('global')} />
        <Divider />
        <ListRow icon={Trash2} color="#dc2626" title="Delete account" subtitle="Your account and all its data, for good" onClick={() => setDeleting(true)} />
      </Card>

      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
      {signOutDialog}
    </section>
  )
}

function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const email = session?.user.email ?? ''
  const twoStep = hasSecondStep(session)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setCode('')
    setSure(false)
    setErr(null)
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!sure || !password) return
    setBusy(true)
    setErr(null)
    try {
      // a password typed just now (and the code, when that step is on) is what the server checks for
      const client = await stepUp(email, password, code)
      const { error } = await client.rpc('delete_my_account')
      if (error) throw error
      // nothing of it is left on this device either
      await clearMyEntries().catch(() => undefined)
      queryClient.clear()
      await idbPersister.removeClient()
      useAppLock.getState().clear()
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      toast.success('Your account and all its data were deleted.')
      navigate('/login', { replace: true })
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Delete account">
      <form onSubmit={submit}>
        <FormStack>
          <p className="text-sm leading-relaxed text-muted">
            This deletes your FinBoard account and everything in it: accounts, transactions, debts, investments, certificates, gold, budgets and history. It can't
            be undone. Want a copy first? Use <b className="text-text">Export everything</b> under Backup.
          </p>
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <Field label="Your password">
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {twoStep ? <CodeField value={code} onChange={setCode} /> : null}
          <Toggle checked={sure} onChange={setSure} label="I understand everything will be deleted" />
          {err ? (
            <p className="text-sm text-negative" role="alert">
              {err}
            </p>
          ) : null}
          <Button type="submit" variant="danger" full size="lg" loading={busy} disabled={!sure || !password}>
            Delete my account
          </Button>
        </FormStack>
      </form>
    </Sheet>
  )
}
