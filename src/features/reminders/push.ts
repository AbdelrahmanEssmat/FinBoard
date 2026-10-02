import { supabase } from '@/api/supabase'

/**
 * This device and Web Push. iPhones support it for apps added to the Home Screen (iOS 16.4+);
 * desktop Chrome / Edge and Android support it in the browser and installed app.
 */
export type PushSupport = 'supported' | 'needs-install' | 'unsupported'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (ok) return 'supported'
  const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const installed = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iPhone && !installed ? 'needs-install' : 'unsupported'
}

/** The server's public key for push, or null when reminders aren't set up on the server yet. */
export async function serverPushKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push-key', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { publicKey?: string }
    return body.publicKey || null
  } catch {
    return null
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  // wait until the worker is active (a fresh install takes a moment), but never forever
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 8000))])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    return (await (await registration())?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

const keyBytes = (base64url: string) => {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Ask for permission (must follow a tap), subscribe this device and register it for the signed-in person. */
export async function enablePush(publicKey: string): Promise<'on' | 'denied' | 'failed'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await registration()
  if (!reg) return 'failed'
  let sub = await reg.pushManager.getSubscription()
  // a subscription made with an older server key can't receive anything any more: start a fresh one
  if (sub && !sameKey(sub.options.applicationServerKey, keyBytes(publicKey))) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  return (await saveSubscription(sub)) ? 'on' : 'failed'
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 500),
  })
  if (error) throw error
  return true
}

/**
 * When the app starts: the browser may have renewed this device's push address since it was saved,
 * so save the current one again (the same address is simply updated). Does nothing without permission.
 */
export async function refreshPushRegistration(): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await saveSubscription(sub).catch(() => undefined)
}

/** Stop reminders on this device. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => undefined)
}

/** Ask the server to send a test notification to this device. */
export async function sendTestPush(): Promise<'sent' | 'not-configured' | 'failed'> {
  const sub = await currentSubscription()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!sub || !token) return 'failed'
  try {
    const res = await fetch('/api/push-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
    if (res.status === 501) return 'not-configured'
    if (!res.ok) return 'failed'
    const body = (await res.json()) as { sent?: number }
    return (body.sent ?? 0) > 0 ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
