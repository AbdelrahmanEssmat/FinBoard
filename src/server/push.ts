/**
 * Phone and desktop reminders (Web Push): everything the server does.
 *
 * The app works out what to remind each person about (card payment due, debt installments, bills,
 * certificate payouts and maturities), with no amounts in the text, and keeps their upcoming rows in
 * public.reminders. Every device that turns reminders on is a row in public.push_subscriptions.
 * Once a day Vercel Cron calls /api/reminders, which sends what is due today (plus anything a missed
 * run left over from yesterday) to each of that person's devices and marks it sent.
 *
 * Used by the Vercel functions in api/ (push-key, push-test, reminders). One file with no relative
 * imports (like src/domain/goldSources.ts), so it bundles into those functions without surprises.
 * The logic takes its outside world as arguments (a small PushStore and a send function), so the
 * tests run without a network; supabasePushStore() and webPushSender() are the real ones.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ================================================================================== settings

/** The live project, used when the server has no SUPABASE_URL (both values are public by design). */
export const PRODUCTION_SUPABASE_URL = 'https://qddbhmiqsolhnzduvswt.supabase.co'
export const PRODUCTION_PUBLISHABLE_KEY = 'sb_publishable_27vP6q8OGwDJAE3tXkPaNw_xJlVDteZ'
export const DEFAULT_VAPID_SUBJECT = 'mailto:finboard.webapp@gmail.com'
export const DEFAULT_TIMEZONE = 'Africa/Cairo'

/** At most this many notifications per person per run; when more are due, the last one sums up the rest. */
export const MAX_NOTIFICATIONS_PER_USER = 4
/** How long a push service keeps trying to reach a device that is switched off (12 hours). */
export const PUSH_TTL_SECONDS = 12 * 60 * 60
/** Give up on a push service that doesn't answer within this long (milliseconds). */
export const PUSH_TIMEOUT_MS = 10_000

const DB_TIMEOUT_MS = 15_000
const PAGE_SIZE = 1000
const IDS_PER_REQUEST = 100

export type Env = Record<string, string | undefined>

export interface PushConfig {
  supabaseUrl: string
  /** The publishable (anon) key: enough to check who a sign-in token belongs to. */
  publishableKey: string
  /** The secret (service-role) key: reads and updates everyone's devices and reminders. */
  secretKey?: string
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject: string
  /** Vercel sends it as "Authorization: Bearer <CRON_SECRET>" when it runs the daily job. */
  cronSecret?: string
}

function firstSet(env: Env, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** Reads the server settings from environment variables (Vercel project settings, or .env files in development). */
export function readPushConfig(env: Env): PushConfig {
  return {
    supabaseUrl: firstSet(env, 'SUPABASE_URL', 'VITE_SUPABASE_URL') ?? PRODUCTION_SUPABASE_URL,
    publishableKey: firstSet(env, 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY') ?? PRODUCTION_PUBLISHABLE_KEY,
    secretKey: firstSet(env, 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublicKey: firstSet(env, 'VAPID_PUBLIC_KEY'),
    vapidPrivateKey: firstSet(env, 'VAPID_PRIVATE_KEY'),
    vapidSubject: firstSet(env, 'VAPID_SUBJECT') ?? DEFAULT_VAPID_SUBJECT,
    cronSecret: firstSet(env, 'CRON_SECRET'),
  }
}

/** Names of the environment variables still missing for sending to devices ('send') or for the daily run ('cron'). */
export function missingPushConfig(config: PushConfig, task: 'send' | 'cron' = 'send'): string[] {
  const missing: string[] = []
  if (!config.secretKey) missing.push('SUPABASE_SECRET_KEY')
  if (!config.vapidPublicKey) missing.push('VAPID_PUBLIC_KEY')
  if (!config.vapidPrivateKey) missing.push('VAPID_PRIVATE_KEY')
  if (task === 'cron' && !config.cronSecret) missing.push('CRON_SECRET')
  return missing
}

// ================================================================================== dates

/** Today's date ('YYYY-MM-DD') in an IANA time zone. An unknown or empty zone counts as Cairo. */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  for (const zone of [timezone?.trim(), DEFAULT_TIMEZONE]) {
    if (!zone) continue
    try {
      const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
      const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
    } catch {
      // not a time zone this server knows: use Cairo
    }
  }
  throw new RangeError(`Not a valid time: ${String(now)}`)
}

/** 'YYYY-MM-DD' moved by a number of days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// ================================================================================== the data

/** A device that turned reminders on (public.push_subscriptions). */
export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** A reminder waiting to be sent (public.reminders). */
export interface ReminderRow {
  id: string
  key: string
  remind_on: string
  title: string
  body: string
  url: string | null
}

/** What a device receives; public/push-sw.js turns it into the notification. */
export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

export const TEST_PAYLOAD: PushPayload = { title: 'FinBoard reminders are on', body: 'This is how a reminder will look.', url: '/settings', tag: 'finboard-test' }

/** The database, as the few operations sending needs. */
export interface PushStore {
  /** Saved devices: everyone's, or one person's (optionally only the one with this endpoint). */
  listSubscriptions(filter?: { userId: string; endpoint?: string }): Promise<PushSubscriptionRow[]>
  /** Each person's time zone (settings.timezone); people without settings are left out. */
  timezones(userIds: string[]): Promise<Map<string, string>>
  /** One person's unsent reminders with remind_on from `from` to `to` (both included), oldest first, then by key. */
  dueReminders(userId: string, from: string, to: string): Promise<ReminderRow[]>
  /** Marks reminders sent at `at` (an ISO time). */
  markSent(reminderIds: string[], at: string): Promise<void>
  /** Forgets a device whose push service says it no longer exists. */
  deleteSubscription(subscription: PushSubscriptionRow): Promise<void>
  /** Notes when devices last accepted a notification (last_success_at). */
  markDelivered(subscriptionIds: string[], at: string): Promise<void>
  /** Whether the person recorded anything themselves (not automatic entries) dated `day`. */
  recordedOn?(userId: string, day: string): Promise<boolean>
  /** Which of these keys were already sent to the person once (any date). */
  sentKeys?(userId: string, keys: string[]): Promise<Set<string>>
}

/**
 * Two runs a day. In the morning: everything except evening reminders (yesterday's unsent ones too).
 * In the evening: only today's evening reminders (keys starting "evening:").
 */
export type DeliverySlot = 'morning' | 'evening'
/** The end-of-day check-in: sent only on days nothing was recorded. */
const CHECKIN_PREFIX = 'evening:checkin:'
/** Reminders sent once ever (an out-of-date prices nudge per week, a budget per month): never repeated on later days. */
const ONCE_PREFIX = 'once:'

/** Sends one notification to one device. Rejects (with statusCode when the push service answered) if it wasn't accepted. */
export type SendPush = (subscription: PushSubscriptionRow, payload: PushPayload) => Promise<unknown>

export interface PushDeps {
  store: PushStore
  send: SendPush
  /** Where problems are reported as they happen (they are also returned in the summary). */
  log?: (message: string) => void
}

export interface DeliverySummary {
  /** People with at least one device who were checked. */
  users: number
  /** Reminders marked sent (at least one of the person's devices accepted them). */
  reminders: number
  /** Notifications accepted by push services, counted per device. */
  notifications: number
  /** Devices forgotten because their push service said they no longer exist (404/410). */
  removedSubscriptions: number
  errors: string[]
}

// ================================================================================== sending

export interface PlannedNotification {
  payload: PushPayload
  reminderIds: string[]
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** The "and N more" notification that stands in for the reminders that didn't get their own. */
export function moreNotification(count: number): PushPayload {
  return { title: `And ${count} more due today`, body: `Open FinBoard to see ${count === 1 ? 'it' : 'them all'}.`, url: '/', tag: 'finboard-more' }
}

/** Turns one person's due reminders (oldest first) into at most MAX_NOTIFICATIONS_PER_USER notifications. */
export function planNotifications(due: ReminderRow[]): PlannedNotification[] {
  const one = (r: ReminderRow): PlannedNotification => ({
    payload: { title: clip(r.title, 120), body: clip(r.body, 300), url: r.url?.trim() || '/', tag: r.key },
    reminderIds: [r.id],
  })
  if (due.length <= MAX_NOTIFICATIONS_PER_USER) return due.map(one)
  const rest = due.slice(MAX_NOTIFICATIONS_PER_USER - 1)
  return [...due.slice(0, MAX_NOTIFICATIONS_PER_USER - 1).map(one), { payload: moreNotification(rest.length), reminderIds: rest.map((r) => r.id) }]
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null | undefined)?.statusCode
  return typeof status === 'number' ? status : undefined
}

/** The push service says this device no longer exists (unsubscribed, app removed, expired). */
export function isGone(error: unknown): boolean {
  const status = statusOf(error)
  return status === 404 || status === 410
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : String(error)
}

function sendErrorText(error: unknown, endpoint: string): string {
  let host = 'push service'
  try {
    host = new URL(endpoint).host
  } catch {
    // keep the generic name
  }
  const status = statusOf(error)
  if (status === undefined) return `${host}: ${errorText(error)}`
  const body = (error as { body?: unknown }).body
  const detail = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  return `${host} answered ${status}${detail ? ` (${detail})` : ''}`
}

const who = (userId: string) => `user ${userId.slice(0, 8)}`

async function attempt(send: SendPush, device: PushSubscriptionRow, payload: PushPayload): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await send(device, payload)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Sends everyone's due reminders. For each person with at least one device: their unsent reminders
 * dated yesterday or today in their own time zone (yesterday catches up one missed run), oldest
 * first, at most MAX_NOTIFICATIONS_PER_USER notifications, each to every device. A reminder is
 * marked sent once at least one device accepted it; a device the push service calls gone (404/410)
 * is forgotten. One person's or one device's problem is recorded and never stops the rest; only
 * failing to read the device list at all throws.
 */
export async function deliverDueReminders(deps: PushDeps, now: Date = new Date(), slot: DeliverySlot = 'morning'): Promise<DeliverySummary> {
  const summary: DeliverySummary = { users: 0, reminders: 0, notifications: 0, removedSubscriptions: 0, errors: [] }
  const report = (message: string) => {
    summary.errors.push(message)
    deps.log?.(message)
  }

  const devicesByUser = new Map<string, PushSubscriptionRow[]>()
  for (const device of await deps.store.listSubscriptions()) {
    const devices = devicesByUser.get(device.user_id)
    if (devices) devices.push(device)
    else devicesByUser.set(device.user_id, [device])
  }
  if (devicesByUser.size === 0) return summary

  let zones = new Map<string, string>()
  try {
    zones = await deps.store.timezones([...devicesByUser.keys()])
  } catch (e) {
    report(`time zones: ${errorText(e)} (used ${DEFAULT_TIMEZONE} for everyone)`)
  }

  const at = now.toISOString()
  for (const [userId, devices] of devicesByUser) {
    summary.users++
    try {
      const today = todayIn(zones.get(userId), now)
      let due = (await deps.store.dueReminders(userId, addDays(today, -1), today)).filter((r) =>
        slot === 'evening' ? r.key.startsWith('evening:') && r.remind_on === today : !r.key.startsWith('evening:'),
      )
      // reminders that are not needed after all are marked sent without a notification
      const skip: ReminderRow[] = []
      const checkins = due.filter((r) => r.key.startsWith(CHECKIN_PREFIX))
      if (checkins.length && deps.store.recordedOn && (await deps.store.recordedOn(userId, today))) skip.push(...checkins)
      const once = due.filter((r) => r.key.startsWith(ONCE_PREFIX))
      if (once.length && deps.store.sentKeys) {
        const sent = await deps.store.sentKeys(userId, [...new Set(once.map((r) => r.key))])
        skip.push(...once.filter((r) => sent.has(r.key)))
      }
      if (skip.length) {
        const ids = new Set(skip.map((r) => r.id))
        due = due.filter((r) => !ids.has(r.id))
        try {
          await deps.store.markSent([...ids], at)
        } catch (e) {
          report(`${who(userId)}: couldn't put away ${ids.size} reminder(s) that weren't needed: ${errorText(e)}`)
        }
      }
      let live = devices
      const delivered = new Set<string>()

      for (const item of planNotifications(due)) {
        if (live.length === 0) break
        const results = await Promise.all(live.map(async (device) => ({ device, result: await attempt(deps.send, device, item.payload) })))
        let accepted = 0
        for (const { device, result } of results) {
          if (result.ok) {
            accepted++
            summary.notifications++
            delivered.add(device.id)
          } else if (isGone(result.error)) {
            live = live.filter((d) => d.id !== device.id)
            try {
              await deps.store.deleteSubscription(device)
              summary.removedSubscriptions++
            } catch (e) {
              report(`${who(userId)}: couldn't forget a device that is gone: ${errorText(e)}`)
            }
          } else {
            report(`${who(userId)}: ${sendErrorText(result.error, device.endpoint)}`)
          }
        }
        if (accepted === 0) continue
        try {
          await deps.store.markSent(item.reminderIds, at)
          summary.reminders += item.reminderIds.length
        } catch (e) {
          report(`${who(userId)}: sent, but couldn't mark ${item.reminderIds.length} reminder(s) sent: ${errorText(e)}`)
        }
      }

      if (delivered.size > 0) {
        try {
          await deps.store.markDelivered([...delivered], at)
        } catch (e) {
          report(`${who(userId)}: couldn't note the delivery time: ${errorText(e)}`)
        }
      }
    } catch (e) {
      report(`${who(userId)}: ${errorText(e)}`)
    }
  }
  return summary
}

/** Sends the sample reminder to a person's devices (only the one with `endpoint` when given). Returns how many accepted it. */
export async function sendTest(deps: PushDeps, userId: string, endpoint?: string, now: Date = new Date()): Promise<number> {
  const devices = await deps.store.listSubscriptions(endpoint ? { userId, endpoint } : { userId })
  const results = await Promise.all(devices.map(async (device) => ({ device, result: await attempt(deps.send, device, TEST_PAYLOAD) })))
  const delivered: string[] = []
  for (const { device, result } of results) {
    if (result.ok) {
      delivered.push(device.id)
    } else if (isGone(result.error)) {
      await deps.store.deleteSubscription(device).catch((e: unknown) => deps.log?.(`${who(userId)}: couldn't forget a device that is gone: ${errorText(e)}`))
    } else {
      deps.log?.(`${who(userId)} test: ${sendErrorText(result.error, device.endpoint)}`)
    }
  }
  if (delivered.length > 0) {
    await deps.store.markDelivered(delivered, now.toISOString()).catch((e: unknown) => deps.log?.(`${who(userId)}: couldn't note the delivery time: ${errorText(e)}`))
  }
  return delivered.length
}

// ================================================================================== the real database and push services

function fetchWithTimeout(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) })
}

/** supabase-js insists on a WebSocket class even when Realtime is never used; Node 20 and older have none built in. */
class NoWebSocket {
  constructor() {
    throw new Error('Realtime is not used on the server')
  }
}

/** A Supabase connection for server code: no saved session, requests time out, no Realtime needed. */
export function createServerSupabase(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout as typeof fetch },
    ...(typeof globalThis.WebSocket === 'undefined' ? { realtime: { transport: NoWebSocket as never } } : {}),
  })
}

function inParts<T>(items: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size))
  return parts
}

function rowsOf<T>(what: string, result: { data: unknown; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return (result.data ?? []) as T[]
}

/** PushStore on Supabase. Give it a client made with the secret key (it reads everyone's rows). */
export function supabasePushStore(db: SupabaseClient): PushStore {
  return {
    async listSubscriptions(filter) {
      const all: PushSubscriptionRow[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = db.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth')
        if (filter) query = query.eq('user_id', filter.userId)
        if (filter?.endpoint) query = query.eq('endpoint', filter.endpoint)
        const page = rowsOf<PushSubscriptionRow>('push_subscriptions', await query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1))
        all.push(...page)
        if (page.length < PAGE_SIZE) return all
      }
    },
    async timezones(userIds) {
      const zones = new Map<string, string>()
      for (const ids of inParts(userIds, IDS_PER_REQUEST)) {
        const rows = rowsOf<{ user_id: string; timezone: string | null }>('settings', await db.from('settings').select('user_id,timezone').in('user_id', ids))
        for (const row of rows) if (row.timezone) zones.set(row.user_id, row.timezone)
      }
      return zones
    },
    async dueReminders(userId, from, to) {
      const result = await db
        .from('reminders')
        .select('id,key,remind_on,title,body,url')
        .eq('user_id', userId)
        .is('sent_at', null)
        .gte('remind_on', from)
        .lte('remind_on', to)
        .order('remind_on', { ascending: true })
        .order('key', { ascending: true })
      return rowsOf<ReminderRow>('reminders', result)
    },
    async markSent(reminderIds, at) {
      for (const ids of inParts(reminderIds, IDS_PER_REQUEST)) {
        rowsOf('reminders', await db.from('reminders').update({ sent_at: at }).in('id', ids).is('sent_at', null))
      }
    },
    async deleteSubscription(subscription) {
      rowsOf('push_subscriptions', await db.from('push_subscriptions').delete().eq('id', subscription.id).eq('endpoint', subscription.endpoint))
    },
    async markDelivered(subscriptionIds, at) {
      for (const ids of inParts(subscriptionIds, IDS_PER_REQUEST)) {
        rowsOf('push_subscriptions', await db.from('push_subscriptions').update({ last_success_at: at }).in('id', ids))
      }
    },
    async recordedOn(userId, day) {
      // typed in by the person (or a repayment), not posted automatically
      const rows = rowsOf('transactions', await db.from('transactions').select('id').eq('user_id', userId).eq('date', day).in('source', ['manual', 'debt']).limit(1))
      return rows.length > 0
    },
    async sentKeys(userId, keys) {
      const sent = new Set<string>()
      for (const part of inParts(keys, IDS_PER_REQUEST)) {
        const rows = rowsOf<{ key: string }>('reminders', await db.from('reminders').select('key').eq('user_id', userId).in('key', part).not('sent_at', 'is', null))
        for (const row of rows) sent.add(row.key)
      }
      return sent
    },
  }
}

/** The parts of the web-push package used here (the functions in api/ pass the real module in). */
export interface WebPushLike {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { TTL: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; timeout: number },
  ): Promise<unknown>
}

/** SendPush through web-push with this server's VAPID keys. Throws if the keys are missing or malformed. */
export function webPushSender(webpush: WebPushLike, config: PushConfig): SendPush {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set')
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)
  return (subscription, payload) =>
    webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { TTL: PUSH_TTL_SECONDS, urgency: 'normal', timeout: PUSH_TIMEOUT_MS },
    )
}

// ================================================================================== HTTP (the functions in api/)

export type TokenCheck = { userId: string } | { error: 'invalid' | 'unavailable' }

export interface ApiDeps {
  env: Env
  webpush: WebPushLike
  /** Replaces the Supabase database (tests). */
  store?: PushStore
  /** Replaces the sign-in check (tests). */
  verifyToken?: (token: string) => Promise<TokenCheck>
  now?: () => Date
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

const NOT_SET_UP = "Reminders aren't set up on the server yet."
const SIGN_IN_AGAIN = 'Sign in again, then try once more.'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** The token from an "Authorization: Bearer <token>" header. */
export function bearerToken(header: string | null | undefined): string | undefined {
  return header?.match(/^\s*Bearer\s+(\S+)\s*$/i)?.[1]
}

/** Compares a secret without stopping at the first difference (so timing doesn't give it away). */
export function safeEqual(given: string, expected: string): boolean {
  let diff = given.length === expected.length ? 0 : 1
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** Who a Supabase access token belongs to, checked with Supabase Auth. */
async function verifyAccessToken(config: PushConfig, token: string): Promise<TokenCheck> {
  try {
    const { data, error } = await createServerSupabase(config.supabaseUrl, config.publishableKey).auth.getUser(token)
    if (data?.user?.id) return { userId: data.user.id }
    const status = (error as { status?: unknown } | null)?.status
    // 4xx: the token is wrong or expired; no answer or 5xx: Supabase couldn't be asked
    return !error || (typeof status === 'number' && status >= 400 && status < 500) ? { error: 'invalid' } : { error: 'unavailable' }
  } catch {
    return { error: 'unavailable' }
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text()
    if (!text || text.length > 10_000) return {}
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** GET /api/push-key → 200 { publicKey } | 501 { error: 'not_configured' }. */
export function handlePushKey(deps: Pick<ApiDeps, 'env'>): Response {
  const { vapidPublicKey } = readPushConfig(deps.env)
  if (!vapidPublicKey) return json({ error: 'not_configured', message: NOT_SET_UP }, 501)
  return json({ publicKey: vapidPublicKey })
}

/** POST /api/push-test (Authorization: Bearer <access token>, body { endpoint? }) → 200 { sent } | 401 | 501. */
export async function handlePushTest(request: Request, deps: ApiDeps): Promise<Response> {
  const logger = deps.logger ?? console
  const config = readPushConfig(deps.env)
  const token = bearerToken(request.headers.get('authorization'))
  if (!token) return json({ error: 'unauthorized', message: SIGN_IN_AGAIN }, 401)

  const check = await (deps.verifyToken ?? ((t: string) => verifyAccessToken(config, t)))(token)
  if ('error' in check) {
    if (check.error === 'unavailable') return json({ error: 'auth_unavailable', message: "Couldn't check your sign-in just now. Try again in a minute." }, 502)
    return json({ error: 'unauthorized', message: SIGN_IN_AGAIN }, 401)
  }

  const missing = missingPushConfig(config, 'send')
  if (missing.length > 0) return json({ error: 'not_configured', message: NOT_SET_UP, missing }, 501)

  const body = await readJsonBody(request)
  const endpoint = typeof body.endpoint === 'string' && body.endpoint.trim() ? body.endpoint.trim() : undefined
  try {
    const store = deps.store ?? supabasePushStore(createServerSupabase(config.supabaseUrl, config.secretKey!))
    const sent = await sendTest({ store, send: webPushSender(deps.webpush, config), log: (m) => logger.warn(`push-test: ${m}`) }, check.userId, endpoint, deps.now?.())
    return json({ sent })
  } catch (e) {
    logger.error(`push-test: ${errorText(e)}`)
    return json({ error: 'failed', message: "Couldn't send the test reminder. Try again in a minute." }, 500)
  }
}

/** The evening cron schedule in vercel.json (any time from 18:00 UTC: 20:00-21:00 in Cairo). */
export const EVENING_SCHEDULE = '0 18 * * *'

/** Which run this is: Vercel names the schedule that fired in x-vercel-cron-schedule. */
export function slotOf(request: Request): DeliverySlot {
  const schedule = request.headers.get('x-vercel-cron-schedule')
  const asked = new URL(request.url).searchParams.get('slot')
  return schedule === EVENING_SCHEDULE || asked === 'evening' ? 'evening' : 'morning'
}

/** GET /api/reminders, run daily by Vercel Cron (Authorization: Bearer <CRON_SECRET>) → 200 DeliverySummary | 401 | 501. */
export async function handleReminders(request: Request, deps: ApiDeps): Promise<Response> {
  const logger = deps.logger ?? console
  const config = readPushConfig(deps.env)
  if (!config.cronSecret) return json({ error: 'not_configured', message: NOT_SET_UP, missing: missingPushConfig(config, 'cron') }, 501)
  if (!safeEqual(request.headers.get('authorization') ?? '', `Bearer ${config.cronSecret}`)) return json({ error: 'unauthorized' }, 401)

  const missing = missingPushConfig(config, 'cron')
  if (missing.length > 0) return json({ error: 'not_configured', message: NOT_SET_UP, missing }, 501)

  try {
    const store = deps.store ?? supabasePushStore(createServerSupabase(config.supabaseUrl, config.secretKey!))
    // Vercel runs this twice a day (vercel.json); the evening schedule (or ?slot=evening by hand) sends the evening ones
    const slot = slotOf(request)
    const summary = await deliverDueReminders({ store, send: webPushSender(deps.webpush, config), log: (m) => logger.warn(`reminders: ${m}`) }, deps.now?.(), slot)
    logger.info(
      `reminders: ${summary.users} people checked, ${summary.reminders} reminders sent as ${summary.notifications} notifications, ` +
        `${summary.removedSubscriptions} gone devices removed, ${summary.errors.length} problems`,
    )
    return json(summary)
  } catch (e) {
    logger.error(`reminders: the run failed: ${errorText(e)}`)
    return json({ error: 'failed', message: errorText(e) }, 500)
  }
}
