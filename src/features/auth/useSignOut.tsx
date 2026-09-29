import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui'
import { supabase } from '@/api/supabase'
import { pendingCount } from '@/offline/outbox'
import { toast } from '@/store/toasts'
import { authMessage } from '@/features/auth/authErrors'

export type SignOutScope = 'local' | 'global'

/**
 * Signing out, with the same care everywhere: signing out everywhere is always confirmed, and
 * signing out on this device is confirmed when changes made offline haven't reached the server
 * yet. Render `dialog` once in the component that calls `askSignOut`.
 */
export function useSignOut() {
  const [confirm, setConfirm] = useState<{ scope: SignOutScope; pending: number } | null>(null)

  const signOut = (scope: SignOutScope) => supabase.auth.signOut({ scope }).catch((e) => toast.error(authMessage(e)))

  const askSignOut = async (scope: SignOutScope) => {
    const pending = await pendingCount()
    if (pending > 0 || scope === 'global') setConfirm({ scope, pending })
    else void signOut(scope)
  }

  const pendingNote = (n: number) => (n > 0 ? ` You have ${n} change${n === 1 ? '' : 's'} that haven't synced yet. They stay saved on this device and sync the next time you sign in here.` : '')

  const dialog = (
    <ConfirmDialog
      open={Boolean(confirm)}
      onClose={() => setConfirm(null)}
      title={confirm?.scope === 'global' ? 'Sign out everywhere?' : 'Sign out now?'}
      message={(confirm?.scope === 'global' ? 'You’ll be signed out on every device, including this one.' : '') + pendingNote(confirm?.pending ?? 0)}
      confirmLabel="Sign out"
      onConfirm={() => confirm && void signOut(confirm.scope)}
    />
  )

  return { askSignOut, dialog }
}
