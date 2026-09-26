// End-to-end backup/restore test against the local stack (dev-local). Not part of the unit suite.
// WARNING: it deletes and recreates the local test user (test@local.test). Run with:
//   npx vitest run --config dev-local/vitest.integration.config.ts
import { beforeAll, expect, test, vi } from 'vitest'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const holder = vi.hoisted(() => ({ client: null as any }))
vi.mock('@/api/supabase', () => ({
  get supabase() {
    return holder.client
  },
  isNetworkError: () => false,
  isConfigured: true,
  isLocalStack: true,
}))
vi.mock('@/utils', async (orig) => ({ ...(await orig<any>()), downloadFile: () => undefined }))

import { fetchAllTables, importAll } from '@/api/backup'

const USER = '11111111-1111-1111-1111-111111111111'
const SECRET = 'local-dev-jwt-secret-please-do-not-use-in-production-0123456789'
const PSQL = 'D:/Work/Financial Tracker/dev-local/bin/pg/pgsql/bin/psql.exe'
const b64 = (s: string) => Buffer.from(s).toString('base64url')
function jwt(sub: string) {
  const now = Math.floor(Date.now() / 1000)
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64(JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }))
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
function client(sub: string) {
  const c = createClient('http://127.0.0.1:54321', 'local', { global: { headers: { Authorization: `Bearer ${jwt(sub)}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  ;(c.auth as any).getUser = async () => ({ data: { user: { id: sub } }, error: null })
  return c
}
function sql(q: string) {
  return execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'finance', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
}

const MINE = ['accounts', 'sub_accounts', 'categories', 'contacts', 'investment_categories', 'certificates', 'certificate_payouts', 'holdings', 'gold_items', 'recurring_transactions', 'budgets', 'transactions', 'debts', 'debt_payments', 'currencies']

let before: Record<string, any[]>
beforeAll(async () => {
  holder.client = client(USER)
  before = await fetchAllTables()
}, 60_000)

test('a backup restores completely into a brand-new account', async () => {
  const backup = JSON.stringify({ app: 'finboard', version: 1, exported_at: new Date().toISOString(), tables: before })
  // wipe the user completely, then recreate it (defaults are seeded again, as for a new sign-up)
  sql(`delete from auth.users where id = '${USER}'`)
  sql(`insert into auth.users (id, email) values ('${USER}', 'test@local.test')`)
  expect(Number(sql(`select count(*) from transactions where user_id = '${USER}'`))).toBe(0)

  await importAll(new File([backup], 'backup.json', { type: 'application/json' }))

  const after = await fetchAllTables()
  for (const t of MINE) {
    const b = (before[t] ?? []).filter((r: any) => r.user_id === USER)
    const a = (after[t] ?? []).filter((r: any) => r.user_id === USER)
    expect({ table: t, count: a.length }).toEqual({ table: t, count: b.length })
  }
  // every balance is restored exactly, by id
  const balBefore = Object.fromEntries((before.sub_accounts ?? []).map((s: any) => [s.id, String(s.balance)]))
  const balAfter = Object.fromEntries((after.sub_accounts ?? []).map((s: any) => [s.id, String(s.balance)]))
  expect(balAfter).toEqual(balBefore)
  // payout statuses and debt statuses survive
  const status = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.id, r.status]))
  expect(status(after.certificate_payouts ?? [])).toEqual(status(before.certificate_payouts ?? []))
  expect(status(after.debts ?? [])).toEqual(status(before.debts ?? []))
  // and the database agrees every balance equals its transactions
  expect(sql(`select not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31'))`)).toBe('t')
}, 120_000)

test('restoring the same backup again changes nothing', async () => {
  const backup = JSON.stringify({ app: 'finboard', version: 1, tables: before })
  await importAll(new File([backup], 'backup.json'))
  const after = await fetchAllTables()
  for (const t of MINE) expect({ t, n: (after[t] ?? []).length }).toEqual({ t, n: (before[t] ?? []).filter((r: any) => r.user_id === USER).length })
}, 120_000)
