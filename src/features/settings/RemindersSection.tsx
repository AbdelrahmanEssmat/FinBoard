import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, Send } from 'lucide-react'
import { Button, Card, Toggle } from '@/components/ui'
import { SectionTitle } from '@/components/shared'
import { toast } from '@/store/toasts'
import { currentSubscription, disablePush, enablePush, pushSupport, sendTestPush, serverPushKey } from '@/features/reminders/push'

type State = 'checking' | 'needs-install' | 'unsupported' | 'not-configured' | 'blocked' | 'off' | 'on'

/** Settings → Reminders: phone notifications for what's due, per device. */
export function RemindersSection() {
  const qc = useQueryClient()
  const [state, setState] = useState<State>('checking')
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const support = pushSupport()
      if (support !== 'supported') return alive && setState(support)
      const publicKey = await serverPushKey()
      if (!alive) return
      setKey(publicKey)
      if (!publicKey) return setState('not-configured')
      if (Notification.permission === 'denied') return setState('blocked')
      setState((await currentSubscription()) ? 'on' : 'off')
    })()
    return () => {
      alive = false
    }
  }, [])

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      if (next && key) {
        const result = await enablePush(key)
        if (result === 'on') {
          setState('on')
          toast.success('Reminders are on for this device')
        } else if (result === 'denied') setState('blocked')
        else toast.error('Reminders couldn’t be turned on. Try again.')
      } else {
        await disablePush()
        setState('off')
        toast.success('Reminders are off for this device')
      }
      void qc.invalidateQueries({ queryKey: ['push_subscriptions'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reminders couldn’t be changed.')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    const result = await sendTestPush()
    setBusy(false)
    if (result === 'sent') toast.success('Test sent: it should arrive in a few seconds')
    else if (result === 'not-configured') setState('not-configured')
    else toast.error('The test couldn’t be sent. Turn reminders off and on, then try again.')
  }

  const note: Record<Exclude<State, 'on' | 'off'>, string> = {
    checking: 'Checking this device…',
    'needs-install': 'On iPhone, reminders work in the Home Screen app: in Safari tap Share → Add to Home Screen, open FinBoard from there, and turn them on here.',
    unsupported: 'This browser can’t show reminders. Try the installed app, Chrome or Edge.',
    'not-configured': 'Reminders need a one-time setup on the server first (see docs/reminders.md in the project).',
    blocked: 'Notifications are blocked for FinBoard. Allow them (iPhone: Settings → Notifications → FinBoard; computer: the site settings next to the address), then come back here.',
  }

  return (
    <section>
      <SectionTitle>Reminders</SectionTitle>
      <Card padded className="space-y-4">
        {state === 'on' || state === 'off' ? (
          <>
            <Toggle
              checked={state === 'on'}
              onChange={(v) => {
                if (!busy) void toggle(v)
              }}
              label="Reminders on this device"
              description="Card payments, instalments, bills, certificate payouts and maturities: the day before and on the day. No amounts are shown."
            />
            {state === 'on' ? (
              <Button variant="secondary" size="sm" onClick={() => void test()} loading={busy}>
                <Send className="h-4 w-4" /> Send a test
              </Button>
            ) : null}
          </>
        ) : (
          <p className="flex items-start gap-3 text-sm leading-relaxed text-muted">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{note[state]}</span>
          </p>
        )}
      </Card>
    </section>
  )
}
