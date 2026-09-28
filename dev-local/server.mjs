// Local stand-in for Supabase (dev only): an auth server that behaves like Supabase Auth for the
// flows FinBoard uses, plus a proxy to PostgREST.   node dev-local/server.mjs → http://127.0.0.1:54321
//
// Auth: real users (dev-local/auth-users.json), the same password rules as production, email
// confirmation, one-time links that expire, password reset, sign out here / others / everywhere.
// test@local.test always signs in with any password (tests and quick local use rely on that).
//
// Emails aren't sent: they're rendered from supabase/templates/*.html (exactly what Supabase
// would send) and listed at http://127.0.0.1:54321/__mail (newest first; click to open).
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEV = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(DEV)
const PORT = 54321
const SECRET = 'local-dev-jwt-secret-please-do-not-use-in-production-0123456789'
const SITE_URL = process.env.LOCAL_SITE_URL || 'http://localhost:5174'
const USERS_FILE = join(DEV, 'auth-users.json')
const PSQL = join(DEV, 'bin', 'pg', 'pgsql', 'bin', 'psql.exe')
const TEST_USER = { id: '11111111-1111-1111-1111-111111111111', email: 'test@local.test' }
const LINK_TTL_MS = 3600_000

// ---------------------------------------------------------------- users
/** email → { id, email, hash, salt, confirmed_at, created_at } */
const users = new Map(existsSync(USERS_FILE) ? Object.entries(JSON.parse(readFileSync(USERS_FILE, 'utf8'))) : [])
if (!users.has(TEST_USER.email)) users.set(TEST_USER.email, { ...TEST_USER, hash: null, salt: null, confirmed_at: new Date(0).toISOString(), created_at: new Date(0).toISOString() })
const saveUsers = () => writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(users), null, 2))
const byId = (id) => [...users.values()].find((u) => u.id === id)

const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex')
function checkPassword(u, pw) {
  if (u.email === TEST_USER.email) return true
  if (!u.hash) return false
  return crypto.timingSafeEqual(Buffer.from(hashPassword(pw, u.salt), 'hex'), Buffer.from(u.hash, 'hex'))
}
function setPassword(u, pw) {
  u.salt = crypto.randomBytes(16).toString('hex')
  u.hash = hashPassword(pw, u.salt)
}

// same rules as production (scripts/configure-supabase-auth.ps1)
function weakReasons(pw) {
  const reasons = []
  if ([...(pw ?? '')].length < 8) reasons.push('length')
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) reasons.push('characters')
  return reasons
}
const EMAIL_RE = /^[^\s@'"\\;]+@[^\s@'"\\;]+\.[^\s@'"\\;]{2,}$/

function userObject(u, extra = {}) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.confirmed_at, confirmed_at: u.confirmed_at, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
    created_at: u.created_at, updated_at: new Date().toISOString(), ...extra,
  }
}

// ---------------------------------------------------------------- sessions
const b64 = (s) => Buffer.from(s).toString('base64url')
function jwt(claims) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}
function readJwt(token) {
  const [h, b, s] = (token ?? '').split('.')
  if (!s) return null
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')
  if (sig !== s) return null
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString())
  return claims.exp * 1000 > Date.now() ? claims : null
}
/** session id → { userId, refresh } */
const sessions = new Map()
function newSession(u, weak) {
  const id = crypto.randomUUID()
  const refresh = crypto.randomBytes(16).toString('hex')
  sessions.set(id, { userId: u.id, refresh })
  return sessionFor(u, id, refresh, weak)
}
function sessionFor(u, sessionId, refresh, weak) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600
  const access_token = jwt({ sub: u.id, role: 'authenticated', email: u.email, aud: 'authenticated', session_id: sessionId, iat: now, exp })
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userObject(u), ...(weak?.length ? { weak_password: { reasons: weak } } : {}) }
}
function bearer(req) {
  const claims = readJwt((req.headers.authorization ?? '').replace(/^Bearer /i, ''))
  if (!claims || !sessions.has(claims.session_id)) return null
  const u = byId(claims.sub)
  return u ? { u, claims } : null
}

// ---------------------------------------------------------------- email links + outbox
/** token hash → { email, type, expires, used } */
const links = new Map()
const outbox = []
const TEMPLATES = join(ROOT, 'supabase', 'templates')

function render(name, vars) {
  const subjects = JSON.parse(readFileSync(join(TEMPLATES, 'subjects.json'), 'utf8'))
  const fill = (s) =>
    s.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (m, key) => {
      if (!(key in vars)) throw new Error(`template ${name}: unknown variable ${m}`)
      return vars[key]
    })
  const html = fill(readFileSync(join(TEMPLATES, `${name}.html`), 'utf8'))
  if (html.includes('{{')) throw new Error(`template ${name}: unfilled placeholder`)
  return { subject: fill(subjects[name]), html }
}
function sendMail(template, u, { type, newEmail, redirectTo = SITE_URL, oldEmail } = {}) {
  let tokenHash = ''
  if (type) {
    const group = (t) => (['email', 'signup', 'magiclink'].includes(t) ? 'confirm' : t)
    for (const [h, l] of links) if (l.email === u.email && group(l.type) === group(type)) links.delete(h) // older link of the same kind stops working
    tokenHash = crypto.createHash('sha224').update(crypto.randomBytes(32)).digest('hex')
    links.set(tokenHash, { email: u.email, type, newEmail, expires: Date.now() + LINK_TTL_MS, used: false })
  }
  const token = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
  const vars = {
    SiteURL: SITE_URL, TokenHash: tokenHash, Token: token, Email: u.email, NewEmail: newEmail ?? '', OldEmail: oldEmail ?? '', RedirectTo: redirectTo, Data: '{}',
    ConfirmationURL: `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=${type}`,
  }
  const { subject, html } = render(template, vars)
  const mail = { id: outbox.length + 1, at: new Date().toISOString(), to: newEmail ?? u.email, template, subject, html, link: type ? vars.ConfirmationURL : null }
  outbox.push(mail)
  console.log(`[mail] ${mail.to} · ${subject}${mail.link ? ` · ${mail.link}` : ''}`)
}

// ---------------------------------------------------------------- database
function createDbUser(id, email) {
  const q = `insert into auth.users (id, email) values ('${id}', '${email.replace(/'/g, "''")}') on conflict do nothing`
  execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'finance', '-v', 'ON_ERROR_STOP=1', '-q', '-c', q], { env: { ...process.env, PGPASSWORD: 'postgres' } })
}

// ---------------------------------------------------------------- http
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', ...cors })
  res.end(JSON.stringify(body))
}
const fail = (res, status, code, msg, extra = {}) => json(res, status, { code: status, error_code: code, msg, message: msg, ...extra })
async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

async function auth(req, res, p, url) {
  const body = req.method === 'GET' ? {} : await readBody(req)
  const email = String(body.email ?? '').trim().toLowerCase()

  if (p === 'health') return json(res, 200, { name: 'local-auth' })
  if (p === 'settings') return json(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: false })

  if (p === 'signup') {
    if (!EMAIL_RE.test(email)) return fail(res, 400, 'email_address_invalid', `Email address "${email}" is invalid`)
    const weak = weakReasons(body.password)
    if (weak.length) return fail(res, 422, 'weak_password', 'Password should be at least 8 characters and contain lowercase, uppercase letters and digits.', { weak_password: { reasons: weak } })
    const existing = users.get(email)
    if (existing?.confirmed_at) {
      // like Supabase: a look-alike answer, no email, so nobody can tell the address is registered
      return json(res, 200, { ...userObject({ ...existing, id: crypto.randomUUID(), confirmed_at: null }), identities: [] })
    }
    const u = existing ?? { id: crypto.randomUUID(), email, confirmed_at: null, created_at: new Date().toISOString() }
    setPassword(u, body.password)
    if (!existing) {
      createDbUser(u.id, email)
      users.set(email, u)
    }
    saveUsers()
    sendMail('confirmation', u, { type: 'email', redirectTo: url.searchParams.get('redirect_to') ?? SITE_URL })
    return json(res, 200, userObject(u))
  }

  if (p === 'token') {
    const grant = url.searchParams.get('grant_type')
    if (grant === 'password') {
      const u = users.get(email)
      if (!u || !checkPassword(u, String(body.password ?? ''))) return fail(res, 400, 'invalid_credentials', 'Invalid login credentials', { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      if (!u.confirmed_at) return fail(res, 400, 'email_not_confirmed', 'Email not confirmed')
      return json(res, 200, newSession(u, u.email === TEST_USER.email ? [] : weakReasons(body.password)))
    }
    if (grant === 'refresh_token') {
      const found = [...sessions.entries()].find(([, s]) => s.refresh === body.refresh_token)
      if (!found) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
      const [id, s] = found
      s.refresh = crypto.randomBytes(16).toString('hex') // rotation
      return json(res, 200, sessionFor(byId(s.userId), id, s.refresh))
    }
    return fail(res, 400, 'validation_failed', 'unsupported grant_type')
  }

  if (p === 'resend') {
    const u = users.get(email)
    if (u && !u.confirmed_at && body.type === 'signup') sendMail('confirmation', u, { type: 'email' })
    return json(res, 200, {})
  }

  if (p === 'recover') {
    const u = users.get(email)
    if (u) sendMail('recovery', u, { type: 'recovery', redirectTo: url.searchParams.get('redirect_to') ?? SITE_URL })
    return json(res, 200, {})
  }

  if (p === 'verify') {
    const link = links.get(body.token_hash)
    const typeOk = link && (link.type === body.type || (['email', 'signup', 'magiclink'].includes(link.type) && ['email', 'signup', 'magiclink'].includes(body.type)))
    if (!link || link.used || link.expires < Date.now() || !typeOk) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
    link.used = true
    const u = users.get(link.email)
    if (!u) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
    if (!u.confirmed_at) u.confirmed_at = new Date().toISOString()
    saveUsers()
    return json(res, 200, newSession(u))
  }

  if (p === 'user' && req.method === 'GET') {
    const who = bearer(req)
    return who ? json(res, 200, userObject(who.u)) : fail(res, 401, 'session_not_found', 'Session not found')
  }

  if (p === 'user' && req.method === 'PUT') {
    const who = bearer(req)
    if (!who) return fail(res, 401, 'session_not_found', 'Session not found')
    if (body.password !== undefined) {
      const weak = weakReasons(body.password)
      if (weak.length) return fail(res, 422, 'weak_password', 'Password should be at least 8 characters and contain lowercase, uppercase letters and digits.', { weak_password: { reasons: weak } })
      if (who.u.hash && checkPassword(who.u, body.password)) return fail(res, 422, 'same_password', 'New password should be different from the old password.')
      setPassword(who.u, body.password)
      saveUsers()
      sendMail('password_changed_notification', who.u)
    }
    return json(res, 200, userObject(who.u))
  }

  if (p === 'logout') {
    const who = bearer(req)
    const scope = url.searchParams.get('scope') ?? 'global'
    if (who) {
      for (const [id, s] of sessions) {
        const mine = s.userId === who.u.id
        const current = id === who.claims.session_id
        if ((scope === 'global' && mine) || (scope === 'local' && current) || (scope === 'others' && mine && !current)) sessions.delete(id)
      }
    }
    res.writeHead(204, cors)
    return res.end()
  }

  return fail(res, 404, 'not_found', `local auth: ${req.method} ${p} is not implemented`)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  try {
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url.pathname.slice('/auth/v1/'.length), url)
  } catch (e) {
    console.error(e)
    return fail(res, 500, 'unexpected_failure', String(e.message ?? e))
  }

  if (url.pathname === '/__mail' || url.pathname === '/__mail.json') {
    const list = [...outbox].reverse()
    if (url.pathname.endsWith('.json')) return json(res, 200, list.map(({ html, ...m }) => m))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(`<!doctype html><meta charset="utf-8"><title>Local mail</title><body style="font-family:system-ui;padding:24px"><h1>Local mail (${list.length})</h1><ul>${list.map((m) => `<li><a href="/__mail/${m.id}">${escapeHtml(m.subject)}</a> → ${escapeHtml(m.to)} · ${m.at}</li>`).join('')}</ul>`)
  }
  const mailMatch = url.pathname.match(/^\/__mail\/(\d+)$/)
  if (mailMatch) {
    const m = outbox.find((x) => x.id === Number(mailMatch[1]))
    if (!m) return json(res, 404, { message: 'no such mail' })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(m.html)
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const headers = { ...req.headers }
    delete headers.host
    delete headers.connection
    delete headers.expect
    const upstream = http.request(
      { host: '127.0.0.1', port: 3001, method: req.method, path: url.pathname.slice('/rest/v1'.length) + url.search, headers },
      (up) => {
        const out = { ...up.headers }
        delete out['transfer-encoding']
        res.writeHead(up.statusCode ?? 502, { ...out, ...cors })
        up.pipe(res)
      },
    )
    upstream.on('error', (e) => json(res, 502, { message: 'postgrest unreachable: ' + e.message }))
    req.pipe(upstream)
    return
  }

  if (url.pathname.startsWith('/realtime/')) {
    res.writeHead(404, cors)
    return res.end()
  }
  json(res, 404, { message: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => console.log(`local supabase stand-in on http://127.0.0.1:${PORT} (mail: http://127.0.0.1:${PORT}/__mail)`))
