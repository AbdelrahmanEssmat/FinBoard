// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addDays,
  bearerToken,
  deliverDueReminders,
  handlePushKey,
  handlePushTest,
  handleReminders,
  missingPushConfig,
  planNotifications,
  PRODUCTION_PUBLISHABLE_KEY,
  PRODUCTION_SUPABASE_URL,
  PUSH_TTL_SECONDS,
  readPushConfig,
  safeEqual,
  sendTest,
  supabasePushStore,
  TEST_PAYLOAD,
  todayIn,
  webPushSender,
  type ApiDeps,
  type PushPayload,
  type PushStore,
  type PushSubscriptionRow,
  type ReminderRow,
  type SendPush,
  type WebPushLike,
} from './push'

// ------------------------------------------------------------------ helpers

/** 06:30 UTC on 2 Oct 2026: the cron's hour; it is 2 Oct in Cairo too. */
const NOW = new Date('2026-10-02T06:30:00Z')

type StoredReminder = ReminderRow & { user_id: string; sent_at: string | null }
type StoredDevice = PushSubscriptionRow & { last_success_at: string | null }

function device(id: string, userId: string): StoredDevice {
  return { id, user_id: userId, endpoint: `https://push.example.com/${id}`, p256dh: `key-${id}`, auth: `auth-${id}`, last_success_at: null }
}

function reminder(id: string, userId: string, remindOn: string, extra: Partial<StoredReminder> = {}): StoredReminder {
  return { id, user_id: userId, key: `key-${id}`, remind_on: remindOn, title: `Title ${id}`, body: `Body ${id}`, url: `/page/${id}`, sent_at: null, ...extra }
}

/** PushStore over plain arrays, behaving like the real tables. */
function memoryStore(data: { devices: StoredDevice[]; reminders: StoredReminder[]; timezones?: Record<string, string> }) {
  const db = { devices: [...data.devices], reminders: [...data.reminders] }
  const store: PushStore = {
    async listSubscriptions(filter) {
      return db.devices.filter((d) => (!filter || d.user_id === filter.userId) && (!filter?.endpoint || d.endpoint === filter.endpoint))
    },
    async timezones(userIds) {
      return new Map(Object.entries(data.timezones ?? {}).filter(([id]) => userIds.includes(id)))
    },
    async dueReminders(userId, from, to) {
      return db.reminders
        .filter((r) => r.user_id === userId && r.sent_at === null && r.remind_on >= from && r.remind_on <= to)
        .sort((a, b) => a.remind_on.localeCompare(b.remind_on) || a.key.localeCompare(b.key))
    },
    async markSent(ids, at) {
      for (const r of db.reminders) if (ids.includes(r.id) && r.sent_at === null) r.sent_at = at
    },
    async deleteSubscription(subscription) {
      db.devices = db.devices.filter((d) => d.id !== subscription.id)
    },
    async markDelivered(ids, at) {
      for (const d of db.devices) if (ids.includes(d.id)) d.last_success_at = at
    },
  }
  return { store, db }
}

/** A push service stand-in: records what each device was sent; `fail` makes a device answer with a status code. */
function pushService(fail: Record<string, number> = {}) {
  const sent: { device: string; payload: PushPayload }[] = []
  const send: SendPush = async (subscription, payload) => {
    const status = fail[subscription.id]
    if (status) throw Object.assign(new Error('Received unexpected response code'), { statusCode: status, body: `status ${status}` })
    sent.push({ device: subscription.id, payload })
  }
  return { send, sent }
}

// ------------------------------------------------------------------ dates

describe('todayIn', () => {
  it("gives each time zone's own date", () => {
    const late = new Date('2026-10-01T22:30:00Z')
    expect(todayIn('UTC', late)).toBe('2026-10-01')
    expect(todayIn('Africa/Cairo', late)).toBe('2026-10-02')
    expect(todayIn('America/New_York', late)).toBe('2026-10-01')
    expect(todayIn('Asia/Tokyo', late)).toBe('2026-10-02')
    expect(todayIn('Pacific/Kiritimati', late)).toBe('2026-10-02')
    expect(todayIn('Pacific/Pago_Pago', late)).toBe('2026-10-01')
    expect(todayIn('Africa/Cairo', new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01')
  })
  it('treats an unknown or missing time zone as Cairo', () => {
    const late = new Date('2026-10-01T22:30:00Z')
    expect(todayIn('Mars/Olympus', late)).toBe('2026-10-02')
    expect(todayIn('', late)).toBe('2026-10-02')
    expect(todayIn(null, late)).toBe('2026-10-02')
    expect(todayIn(undefined, late)).toBe('2026-10-02')
  })
  it('moves dates across month, leap-day and year ends', () => {
    expect(addDays('2026-10-02', -1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

// ------------------------------------------------------------------ delivery

describe('deliverDueReminders', () => {
  it('sends {title, body, url, tag} to every device and marks the reminder sent only after a device accepted it', async () => {
    const { store, db } = memoryStore({ devices: [device('phone', 'u1'), device('desktop', 'u1')], reminders: [reminder('r1', 'u1', '2026-10-02')] })
    const sentAtDuringSend: (string | null)[] = []

    // first run: the push service is down, so nothing is marked
    const down: SendPush = async () => {
      sentAtDuringSend.push(db.reminders[0]!.sent_at)
      throw Object.assign(new Error('Received unexpected response code'), { statusCode: 503, body: 'try later' })
    }
    const first = await deliverDueReminders({ store, send: down }, NOW)
    expect(first).toMatchObject({ users: 1, reminders: 0, notifications: 0, removedSubscriptions: 0 })
    expect(first.errors).toEqual(['user u1: push.example.com answered 503 (try later)', 'user u1: push.example.com answered 503 (try later)'])
    expect(db.reminders[0]!.sent_at).toBeNull()
    expect(db.devices.map((d) => d.last_success_at)).toEqual([null, null])

    // next run: it works
    const { send, sent } = pushService()
    const watching: SendPush = async (s, p) => {
      sentAtDuringSend.push(db.reminders[0]!.sent_at)
      await send(s, p)
    }
    const second = await deliverDueReminders({ store, send: watching }, NOW)
    expect(second).toEqual({ users: 1, reminders: 1, notifications: 2, removedSubscriptions: 0, errors: [] })
    expect(sent).toEqual([
      { device: 'phone', payload: { title: 'Title r1', body: 'Body r1', url: '/page/r1', tag: 'key-r1' } },
      { device: 'desktop', payload: { title: 'Title r1', body: 'Body r1', url: '/page/r1', tag: 'key-r1' } },
    ])
    expect(sentAtDuringSend).toEqual([null, null, null, null])
    expect(db.reminders[0]!.sent_at).toBe(NOW.toISOString())
    expect(db.devices.map((d) => d.last_success_at)).toEqual([NOW.toISOString(), NOW.toISOString()])

    // and a third run sends nothing again
    const third = await deliverDueReminders({ store, send }, NOW)
    expect(third).toMatchObject({ users: 1, reminders: 0, notifications: 0 })
    expect(sent).toHaveLength(2)
  })

  it('sends at most 4 notifications per person, oldest first; the 4th sums up the rest and opens the app', async () => {
    const reminders = [
      reminder('t1', 'u1', '2026-10-02'),
      reminder('y1', 'u1', '2026-10-01'),
      reminder('t2', 'u1', '2026-10-02'),
      reminder('t3', 'u1', '2026-10-02'),
      reminder('y2', 'u1', '2026-10-01'),
      reminder('t4', 'u1', '2026-10-02'),
    ]
    const { store, db } = memoryStore({ devices: [device('phone', 'u1')], reminders })
    const { send, sent } = pushService()
    const summary = await deliverDueReminders({ store, send }, NOW)
    expect(summary).toEqual({ users: 1, reminders: 6, notifications: 4, removedSubscriptions: 0, errors: [] })
    expect(sent.map((s) => s.payload.tag)).toEqual(['key-y1', 'key-y2', 'key-t1', 'finboard-more'])
    expect(sent[3]!.payload).toEqual({ title: 'And 3 more due today', body: 'Open FinBoard to see them all.', url: '/', tag: 'finboard-more' })
    expect(db.reminders.every((r) => r.sent_at === NOW.toISOString())).toBe(true)
  })

  it('sends exactly 4 due reminders one by one', () => {
    const due = ['a', 'b', 'c', 'd'].map((id) => reminder(id, 'u1', '2026-10-02'))
    expect(planNotifications(due).map((n) => n.payload.tag)).toEqual(['key-a', 'key-b', 'key-c', 'key-d'])
    const five = planNotifications([...due, reminder('e', 'u1', '2026-10-02')])
    expect(five.map((n) => n.payload.title)).toEqual(['Title a', 'Title b', 'Title c', 'And 2 more due today'])
    expect(five[3]!.reminderIds).toEqual(['d', 'e'])
  })

  it('forgets a device the push service calls gone (410) and keeps the reminder when no device got it', async () => {
    const { store, db } = memoryStore({ devices: [device('old-phone', 'u1')], reminders: [reminder('r1', 'u1', '2026-10-02')] })
    const { send, sent } = pushService({ 'old-phone': 410 })
    const summary = await deliverDueReminders({ store, send }, NOW)
    expect(summary).toEqual({ users: 1, reminders: 0, notifications: 0, removedSubscriptions: 1, errors: [] })
    expect(db.devices).toEqual([])
    expect(db.reminders[0]!.sent_at).toBeNull()
    expect(sent).toEqual([])
  })

  it('still marks the reminder sent when another device got it, and stops sending to the gone one (404)', async () => {
    const reminders = [reminder('r1', 'u1', '2026-10-02'), reminder('r2', 'u1', '2026-10-02')]
    const { store, db } = memoryStore({ devices: [device('old-phone', 'u1'), device('desktop', 'u1')], reminders })
    const calls: string[] = []
    const { send: inner, sent } = pushService({ 'old-phone': 404 })
    const send: SendPush = async (s, p) => {
      calls.push(s.id)
      await inner(s, p)
    }
    const summary = await deliverDueReminders({ store, send }, NOW)
    expect(summary).toEqual({ users: 1, reminders: 2, notifications: 2, removedSubscriptions: 1, errors: [] })
    expect(calls).toEqual(['old-phone', 'desktop', 'desktop'])
    expect(sent.map((s) => s.device)).toEqual(['desktop', 'desktop'])
    expect(db.devices.map((d) => d.id)).toEqual(['desktop'])
    expect(db.reminders.map((r) => r.sent_at)).toEqual([NOW.toISOString(), NOW.toISOString()])
  })

  it('skips people without devices', async () => {
    const { store, db } = memoryStore({
      devices: [device('phone', 'u1')],
      reminders: [reminder('mine', 'u1', '2026-10-02'), reminder('theirs', 'u2', '2026-10-02')],
    })
    const dueReminders = vi.spyOn(store, 'dueReminders')
    const { send, sent } = pushService()
    const summary = await deliverDueReminders({ store, send }, NOW)
    expect(summary).toMatchObject({ users: 1, reminders: 1, notifications: 1 })
    expect(dueReminders.mock.calls.map((c) => c[0])).toEqual(['u1'])
    expect(sent.map((s) => s.payload.tag)).toEqual(['key-mine'])
    expect(db.reminders.find((r) => r.id === 'theirs')!.sent_at).toBeNull()
  })

  it('does nothing when nobody has turned reminders on', async () => {
    const { store } = memoryStore({ devices: [], reminders: [reminder('r1', 'u1', '2026-10-02')] })
    const timezones = vi.spyOn(store, 'timezones')
    const summary = await deliverDueReminders({ store, send: pushService().send }, NOW)
    expect(summary).toEqual({ users: 0, reminders: 0, notifications: 0, removedSubscriptions: 0, errors: [] })
    expect(timezones).not.toHaveBeenCalled()
  })

  it("catches up one missed day (not two), in each person's own time zone", async () => {
    const reminders = [
      reminder('two-days-ago', 'cairo', '2026-09-30'),
      reminder('yesterday', 'cairo', '2026-10-01'),
      reminder('already-sent', 'cairo', '2026-10-01', { sent_at: '2026-10-01T06:10:00.000Z' }),
      reminder('today', 'cairo', '2026-10-02'),
      reminder('tomorrow', 'cairo', '2026-10-03'),
      // 06:30 UTC on 2 Oct is still 1 Oct (evening) in Pago Pago, UTC-11
      reminder('pago-yesterday', 'pago', '2026-09-30'),
      reminder('pago-today', 'pago', '2026-10-01'),
      reminder('pago-tomorrow', 'pago', '2026-10-02'),
    ]
    const { store } = memoryStore({ devices: [device('c', 'cairo'), device('p', 'pago')], reminders, timezones: { pago: 'Pacific/Pago_Pago' } })
    const { send, sent } = pushService()
    const summary = await deliverDueReminders({ store, send }, NOW)
    expect(summary).toMatchObject({ users: 2, reminders: 4, notifications: 4, errors: [] })
    expect(sent.map((s) => `${s.device}:${s.payload.tag}`)).toEqual(['c:key-yesterday', 'c:key-today', 'p:key-pago-yesterday', 'p:key-pago-today'])
  })

  it("records one person's problem and carries on with the rest", async () => {
    const { store } = memoryStore({
      devices: [device('a', 'broken-user'), device('b', 'fine-user')],
      reminders: [reminder('r1', 'broken-user', '2026-10-02'), reminder('r2', 'fine-user', '2026-10-02')],
    })
    const real = store.dueReminders.bind(store)
    store.dueReminders = async (userId, from, to) => {
      if (userId === 'broken-user') throw new Error('connection reset')
      return real(userId, from, to)
    }
    const log = vi.fn()
    const { send, sent } = pushService()
    const summary = await deliverDueReminders({ store, send, log }, NOW)
    expect(summary).toMatchObject({ users: 2, reminders: 1, notifications: 1, errors: ['user broken-u: connection reset'] })
    expect(log).toHaveBeenCalledWith('user broken-u: connection reset')
    expect(sent.map((s) => s.device)).toEqual(['b'])
  })

  it('falls back to Cairo when the time zones cannot be read', async () => {
    const { store } = memoryStore({ devices: [device('a', 'u1')], reminders: [reminder('r1', 'u1', '2026-10-02')] })
    store.timezones = async () => {
      throw new Error('settings unavailable')
    }
    const summary = await deliverDueReminders({ store, send: pushService().send }, NOW)
    expect(summary).toMatchObject({ users: 1, reminders: 1, errors: ['time zones: settings unavailable (used Africa/Cairo for everyone)'] })
  })

  it('throws only when the device list itself cannot be read', async () => {
    const { store } = memoryStore({ devices: [], reminders: [] })
    store.listSubscriptions = async () => {
      throw new Error('push_subscriptions: relation does not exist')
    }
    await expect(deliverDueReminders({ store, send: pushService().send }, NOW)).rejects.toThrow('relation does not exist')
  })
})

describe('sendTest', () => {
  const devices = () => [device('phone', 'u1'), device('desktop', 'u1'), device('someone-else', 'u2')]

  it("sends the sample to all of the person's devices", async () => {
    const { store, db } = memoryStore({ devices: devices(), reminders: [] })
    const { send, sent } = pushService()
    expect(await sendTest({ store, send }, 'u1', undefined, NOW)).toBe(2)
    expect(sent).toEqual([
      { device: 'phone', payload: TEST_PAYLOAD },
      { device: 'desktop', payload: TEST_PAYLOAD },
    ])
    expect(TEST_PAYLOAD).toEqual({ title: 'FinBoard reminders are on', body: 'This is how a reminder will look.', url: '/settings', tag: 'finboard-test' })
    expect(db.devices.find((d) => d.id === 'phone')!.last_success_at).toBe(NOW.toISOString())
  })

  it('sends only to the device asked for, and never to someone else\'s', async () => {
    const { store } = memoryStore({ devices: devices(), reminders: [] })
    const { send, sent } = pushService()
    expect(await sendTest({ store, send }, 'u1', 'https://push.example.com/desktop')).toBe(1)
    expect(sent.map((s) => s.device)).toEqual(['desktop'])
    expect(await sendTest({ store, send }, 'u1', 'https://push.example.com/someone-else')).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('forgets a gone device and counts only the ones that accepted', async () => {
    const { store, db } = memoryStore({ devices: devices(), reminders: [] })
    const log = vi.fn()
    const { send } = pushService({ phone: 410, desktop: 500 })
    expect(await sendTest({ store, send, log }, 'u1')).toBe(0)
    expect(db.devices.map((d) => d.id)).toEqual(['desktop', 'someone-else'])
    expect(log).toHaveBeenCalledWith('user u1 test: push.example.com answered 500 (status 500)')
  })
})

// ------------------------------------------------------------------ settings and web-push

describe('server settings', () => {
  it('reads variables with the documented fallbacks', () => {
    expect(readPushConfig({})).toEqual({
      supabaseUrl: PRODUCTION_SUPABASE_URL,
      publishableKey: PRODUCTION_PUBLISHABLE_KEY,
      secretKey: undefined,
      vapidPublicKey: undefined,
      vapidPrivateKey: undefined,
      vapidSubject: 'mailto:finboard.webapp@gmail.com',
      cronSecret: undefined,
    })
    expect(readPushConfig({ VITE_SUPABASE_URL: 'https://vite.example', VITE_SUPABASE_ANON_KEY: 'vite-key' })).toMatchObject({
      supabaseUrl: 'https://vite.example',
      publishableKey: 'vite-key',
    })
    expect(
      readPushConfig({
        SUPABASE_URL: ' https://main.example \n',
        VITE_SUPABASE_URL: 'https://vite.example',
        SUPABASE_PUBLISHABLE_KEY: 'publishable',
        SUPABASE_SECRET_KEY: 'sb_secret_x',
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:someone@example.com',
        CRON_SECRET: 'cron',
      }),
    ).toEqual({
      supabaseUrl: 'https://main.example',
      publishableKey: 'publishable',
      secretKey: 'sb_secret_x',
      vapidPublicKey: 'pub',
      vapidPrivateKey: 'priv',
      vapidSubject: 'mailto:someone@example.com',
      cronSecret: 'cron',
    })
    expect(readPushConfig({ SUPABASE_ANON_KEY: 'anon', SUPABASE_PUBLISHABLE_KEY: 'publishable' }).publishableKey).toBe('anon')
    expect(readPushConfig({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' }).secretKey).toBe('legacy')
  })

  it('tells which required variables are missing', () => {
    expect(missingPushConfig(readPushConfig({}))).toEqual(['SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'])
    expect(missingPushConfig(readPushConfig({}), 'cron')).toEqual(['SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'CRON_SECRET'])
    expect(missingPushConfig(readPushConfig({ SUPABASE_SECRET_KEY: 's', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', CRON_SECRET: '   ' }), 'cron')).toEqual(['CRON_SECRET'])
    expect(missingPushConfig(readPushConfig({ SUPABASE_SECRET_KEY: 's', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' }))).toEqual([])
  })

  it('sends through web-push with the VAPID keys, a 12-hour TTL and normal urgency', async () => {
    const webpush = { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) }
    const send = webPushSender(webpush, readPushConfig({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }))
    expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:finboard.webapp@gmail.com', 'pub', 'priv')
    const payload = { title: 'T', body: 'B', url: '/debts', tag: 'debt:1' }
    await send(device('phone', 'u1'), payload)
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.com/phone', keys: { p256dh: 'key-phone', auth: 'auth-phone' } },
      JSON.stringify(payload),
      { TTL: 12 * 60 * 60, urgency: 'normal', timeout: 10_000 },
    )
    expect(PUSH_TTL_SECONDS).toBe(43_200)
    expect(() => webPushSender(webpush, readPushConfig({}))).toThrow('VAPID')
  })
})

// ------------------------------------------------------------------ the Supabase store

type Step = [string, ...unknown[]]
interface Call {
  table: string
  steps: Step[]
}

/** A stand-in for the Supabase client that records every query; `answer` decides what each one returns. */
function recordingSupabase(answer: (call: Call) => { data?: unknown; error?: { message: string } } = () => ({})) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, steps: [] }
      calls.push(call)
      const builder: any = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (value: unknown) => void) => {
                const { data = null, error = null } = answer(call)
                resolve({ data, error })
              }
            }
            return (...args: unknown[]) => {
              call.steps.push([String(prop), ...args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }
  return { db: client as unknown as SupabaseClient, calls }
}

describe('supabasePushStore', () => {
  it('reads all devices page by page, or one person\'s (one endpoint)', async () => {
    const page = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => device(`d${offset + i}`, 'u1'))
    const { db, calls } = recordingSupabase((call) => {
      const range = call.steps.find((s) => s[0] === 'range')!
      return { data: range[1] === 0 ? page(1000) : page(1, 1000) }
    })
    const store = supabasePushStore(db)
    expect(await store.listSubscriptions()).toHaveLength(1001)
    expect(calls.map((c) => c.steps)).toEqual([
      [['select', 'id,user_id,endpoint,p256dh,auth'], ['order', 'id', { ascending: true }], ['range', 0, 999]],
      [['select', 'id,user_id,endpoint,p256dh,auth'], ['order', 'id', { ascending: true }], ['range', 1000, 1999]],
    ])
    expect(calls[0]!.table).toBe('push_subscriptions')

    calls.length = 0
    await store.listSubscriptions({ userId: 'u1', endpoint: 'https://push.example.com/x' })
    expect(calls[0]!.steps).toEqual([
      ['select', 'id,user_id,endpoint,p256dh,auth'],
      ['eq', 'user_id', 'u1'],
      ['eq', 'endpoint', 'https://push.example.com/x'],
      ['order', 'id', { ascending: true }],
      ['range', 0, 999],
    ])
  })

  it("reads one person's unsent reminders for the window, oldest first", async () => {
    const { db, calls } = recordingSupabase(() => ({ data: [reminder('r1', 'u1', '2026-10-01')] }))
    expect(await supabasePushStore(db).dueReminders('u1', '2026-10-01', '2026-10-02')).toHaveLength(1)
    expect(calls).toEqual([
      {
        table: 'reminders',
        steps: [
          ['select', 'id,key,remind_on,title,body,url'],
          ['eq', 'user_id', 'u1'],
          ['is', 'sent_at', null],
          ['gte', 'remind_on', '2026-10-01'],
          ['lte', 'remind_on', '2026-10-02'],
          ['order', 'remind_on', { ascending: true }],
          ['order', 'key', { ascending: true }],
        ],
      },
    ])
  })

  it('reads time zones in batches and leaves out people without one', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `u${i}`)
    const { db, calls } = recordingSupabase((call) => {
      const asked = call.steps.find((s) => s[0] === 'in')![2] as string[]
      return { data: asked.map((id) => ({ user_id: id, timezone: id === 'u0' ? 'Asia/Dubai' : id === 'u1' ? null : 'Africa/Cairo' })) }
    })
    const zones = await supabasePushStore(db).timezones(ids)
    expect(calls.map((c) => [c.table, (c.steps[1]![2] as string[]).length])).toEqual([
      ['settings', 100],
      ['settings', 50],
    ])
    expect(calls[0]!.steps[0]).toEqual(['select', 'user_id,timezone'])
    expect(zones.get('u0')).toBe('Asia/Dubai')
    expect(zones.has('u1')).toBe(false)
    expect(zones.size).toBe(149)
  })

  it('marks reminders sent, notes deliveries and forgets gone devices with exact filters', async () => {
    const { db, calls } = recordingSupabase()
    const store = supabasePushStore(db)
    await store.markSent(['r1', 'r2'], NOW.toISOString())
    await store.markDelivered(['phone'], NOW.toISOString())
    await store.deleteSubscription(device('phone', 'u1'))
    expect(calls).toEqual([
      { table: 'reminders', steps: [['update', { sent_at: NOW.toISOString() }], ['in', 'id', ['r1', 'r2']], ['is', 'sent_at', null]] },
      { table: 'push_subscriptions', steps: [['update', { last_success_at: NOW.toISOString() }], ['in', 'id', ['phone']]] },
      { table: 'push_subscriptions', steps: [['delete'], ['eq', 'id', 'phone'], ['eq', 'endpoint', 'https://push.example.com/phone']] },
    ])
  })

  it('turns a database error into a thrown error', async () => {
    const { db } = recordingSupabase(() => ({ error: { message: 'permission denied for table reminders' } }))
    await expect(supabasePushStore(db).dueReminders('u1', '2026-10-01', '2026-10-02')).rejects.toThrow('reminders: permission denied for table reminders')
    await expect(supabasePushStore(db).markSent(['r1'], NOW.toISOString())).rejects.toThrow('permission denied')
  })
})

// ------------------------------------------------------------------ the HTTP handlers

const CONFIGURED = { SUPABASE_SECRET_KEY: 'sb_secret_test', VAPID_PUBLIC_KEY: 'public-key', VAPID_PRIVATE_KEY: 'private-key', CRON_SECRET: 'a-long-cron-secret' }
const silent = { info: () => {}, warn: () => {}, error: () => {} }

function fakeWebPush(fail: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: unknown }[] = []
  const webpush: WebPushLike = {
    setVapidDetails: () => {},
    sendNotification: async (subscription, payload) => {
      const status = fail[subscription.endpoint]
      if (status) throw Object.assign(new Error('Received unexpected response code'), { statusCode: status })
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })
      return { statusCode: 201 }
    },
  }
  return { webpush, sent }
}

function deps(env: Record<string, string>, extra: Partial<ApiDeps> = {}): ApiDeps {
  return { env, webpush: fakeWebPush().webpush, logger: silent, now: () => NOW, ...extra }
}

const post = (headers: Record<string, string> = {}, body?: string) => new Request('http://localhost/api/push-test', { method: 'POST', headers, body })
const cron = (authorization?: string) => new Request('http://localhost/api/reminders', { headers: authorization ? { authorization } : {} })

describe('GET /api/push-key', () => {
  it('gives the public key, or 501 until it is set up', async () => {
    const ok = handlePushKey({ env: CONFIGURED })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(await ok.json()).toEqual({ publicKey: 'public-key' })

    const missing = handlePushKey({ env: {} })
    expect(missing.status).toBe(501)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(await missing.json()).toMatchObject({ error: 'not_configured' })
  })
})

describe('GET /api/reminders', () => {
  it('is 501 while CRON_SECRET is not set, whoever asks', async () => {
    const res = await handleReminders(cron('Bearer anything'), deps({ ...CONFIGURED, CRON_SECRET: '' }))
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ error: 'not_configured', missing: ['CRON_SECRET'] })
  })

  it('refuses callers without the cron secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'Bearer a-long-cron-secre', 'Bearer a-long-cron-secretX', 'a-long-cron-secret']) {
      const res = await handleReminders(cron(authorization), deps(CONFIGURED))
      expect(res.status).toBe(401)
    }
  })

  it('is 501 for the cron when the keys are missing', async () => {
    const res = await handleReminders(cron('Bearer a-long-cron-secret'), deps({ CRON_SECRET: 'a-long-cron-secret' }))
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ missing: ['SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] })
  })

  it('delivers and returns the summary', async () => {
    const { store, db } = memoryStore({ devices: [device('phone', 'u1')], reminders: [reminder('r1', 'u1', '2026-10-02')] })
    const { webpush, sent } = fakeWebPush()
    const res = await handleReminders(cron('Bearer a-long-cron-secret'), deps(CONFIGURED, { store, webpush }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ users: 1, reminders: 1, notifications: 1, removedSubscriptions: 0, errors: [] })
    expect(sent).toEqual([{ endpoint: 'https://push.example.com/phone', payload: { title: 'Title r1', body: 'Body r1', url: '/page/r1', tag: 'key-r1' } }])
    expect(db.reminders[0]!.sent_at).toBe(NOW.toISOString())
  })

  it('answers 500 when the run cannot start', async () => {
    const { store } = memoryStore({ devices: [], reminders: [] })
    store.listSubscriptions = async () => {
      throw new Error('push_subscriptions: relation does not exist')
    }
    const res = await handleReminders(cron('Bearer a-long-cron-secret'), deps(CONFIGURED, { store }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'failed', message: 'push_subscriptions: relation does not exist' })
  })
})

describe('POST /api/push-test', () => {
  const verifyToken = async (token: string) => (token === 'good-token' ? { userId: 'u1' } : { error: 'invalid' as const })

  it('refuses requests without a valid sign-in', async () => {
    expect((await handlePushTest(post(), deps(CONFIGURED, { verifyToken }))).status).toBe(401)
    expect((await handlePushTest(post({ authorization: 'Basic abc' }), deps(CONFIGURED, { verifyToken }))).status).toBe(401)
    const bad = await handlePushTest(post({ authorization: 'Bearer bad-token' }), deps(CONFIGURED, { verifyToken }))
    expect(bad.status).toBe(401)
    expect(await bad.json()).toMatchObject({ error: 'unauthorized' })
  })

  it("says so when the sign-in can't be checked", async () => {
    const res = await handlePushTest(post({ authorization: 'Bearer good-token' }), deps(CONFIGURED, { verifyToken: async () => ({ error: 'unavailable' }) }))
    expect(res.status).toBe(502)
  })

  it('is 501 with an explanation until the server is set up', async () => {
    const res = await handlePushTest(post({ authorization: 'Bearer good-token' }), deps({ CRON_SECRET: 'x' }, { verifyToken }))
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ error: 'not_configured', message: "Reminders aren't set up on the server yet." })
  })

  it("sends the sample to the person's devices, or just the one in the body", async () => {
    const { store } = memoryStore({ devices: [device('phone', 'u1'), device('desktop', 'u1'), device('other', 'u2')], reminders: [] })
    const { webpush, sent } = fakeWebPush()
    const all = await handlePushTest(post({ authorization: 'Bearer good-token' }), deps(CONFIGURED, { store, webpush, verifyToken }))
    expect(all.status).toBe(200)
    expect(await all.json()).toEqual({ sent: 2 })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example.com/phone', 'https://push.example.com/desktop'])
    expect(sent[0]!.payload).toEqual(TEST_PAYLOAD)

    sent.length = 0
    const one = await handlePushTest(
      post({ authorization: 'Bearer good-token', 'content-type': 'application/json' }, JSON.stringify({ endpoint: 'https://push.example.com/desktop' })),
      deps(CONFIGURED, { store, webpush, verifyToken }),
    )
    expect(await one.json()).toEqual({ sent: 1 })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example.com/desktop'])

    sent.length = 0
    const junk = await handlePushTest(post({ authorization: 'Bearer good-token' }, 'not json'), deps(CONFIGURED, { store, webpush, verifyToken }))
    expect(await junk.json()).toEqual({ sent: 2 })
  })
})

describe('request helpers', () => {
  it('reads bearer tokens', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def')
    expect(bearerToken('bearer   abc ')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(bearerToken('Bearer')).toBeUndefined()
    expect(bearerToken(null)).toBeUndefined()
  })
  it('compares secrets exactly', () => {
    expect(safeEqual('Bearer s3cret', 'Bearer s3cret')).toBe(true)
    expect(safeEqual('Bearer s3cre', 'Bearer s3cret')).toBe(false)
    expect(safeEqual('Bearer s3cretX', 'Bearer s3cret')).toBe(false)
    expect(safeEqual('', 'Bearer s3cret')).toBe(false)
    expect(safeEqual('Bearer s3creT', 'Bearer s3cret')).toBe(false)
  })
})
