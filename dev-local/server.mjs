// Local stand-in for Supabase (dev only): an auth server that behaves like Supabase Auth for the
// flows FinBoard uses, plus a proxy to PostgREST.   node dev-local/server.mjs → http://127.0.0.1:54321
//
// Auth: real users (dev-local/auth-users.json), the same password rules as production, email
// confirmation, one-time links that expire, password reset, email change, sign out here / others /
// everywhere, and two-step sign-in with an authenticator app (TOTP factors; sessions are aal1 after
// the password and aal2 once a code was verified, exactly as Supabase reports them).
// test@local.test always signs in with any password (tests and quick local use rely on that).
//
// Emails aren't sent: they're rendered from supabase/templates/*.html (exactly what Supabase
// would send) and listed at http://127.0.0.1:54321/__mail (newest first; click to open).
//
// The database is kept in step through psql: auth.users (sign-up, email change) and auth.mfa_factors
// (every factor added, verified or removed). When a user's auth.users row is gone (account deleted),
// sign-in and refresh fail as for an unknown user and the user is dropped from auth-users.json
// (test@local.test is re-created instead).
//
// Optional environment: LOCAL_AUTH_PORT (54321), LOCAL_SITE_URL (http://localhost:5174, used in email
// links), LOCAL_AUTH_USERS_FILE (dev-local/auth-users.json), LOCAL_AUTH_DB (finance). Give a second
// instance (for tests) its own users file so the two don't overwrite each other's accounts:
//   LOCAL_AUTH_PORT=54331 LOCAL_AUTH_USERS_FILE=../scratch-users.json node dev-local/server.mjs
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEV = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(DEV)
const PORT = Number(process.env.LOCAL_AUTH_PORT) || 54321
const SECRET = 'local-dev-jwt-secret-please-do-not-use-in-production-0123456789'
const SITE_URL = process.env.LOCAL_SITE_URL || 'http://localhost:5174'
const USERS_FILE = process.env.LOCAL_AUTH_USERS_FILE ? resolve(process.env.LOCAL_AUTH_USERS_FILE) : join(DEV, 'auth-users.json')
const DB = process.env.LOCAL_AUTH_DB || 'finance'
const PSQL = join(DEV, 'bin', 'pg', 'pgsql', 'bin', 'psql.exe')
const TEST_USER = { id: '11111111-1111-1111-1111-111111111111', email: 'test@local.test' }
const LINK_TTL_MS = 3600_000
// two-step sign-in limits (Supabase's defaults)
const CHALLENGE_TTL_S = 300 // a challenge has to be answered within 5 minutes
const UNVERIFIED_FACTOR_TTL_MS = 300_000 // an unverified factor that was never challenged expires after 5 minutes
const MAX_FACTORS = 10
const DUPLICATE_EMAIL = 'A user with this email address has already been registered'

// ---------------------------------------------------------------- users
/**
 * email → { id, email, hash, salt, confirmed_at, created_at, new_email?, email_change_sent_at?,
 *           factors?: [{ id, friendly_name, factor_type, status, secret, created_at, updated_at, last_challenged_at }] }
 */
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

/** A factor as Supabase lists it on the user: never the secret, no friendly_name when it has none. */
const publicFactor = (f) => ({
  id: f.id,
  ...(f.friendly_name ? { friendly_name: f.friendly_name } : {}),
  factor_type: f.factor_type,
  status: f.status,
  created_at: f.created_at,
  updated_at: f.updated_at,
  last_challenged_at: f.last_challenged_at ?? null,
})
function userObject(u, extra = {}) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.confirmed_at, confirmed_at: u.confirmed_at,
    // like Supabase: new_email only while an email change waits for its link; email_change_sent_at once one was sent
    ...(u.new_email ? { new_email: u.new_email } : {}),
    ...(u.email_change_sent_at ? { email_change_sent_at: u.email_change_sent_at } : {}),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
    ...(u.factors?.length ? { factors: u.factors.map(publicFactor) } : {}), // Supabase leaves `factors` out when there are none
    created_at: u.created_at, updated_at: new Date().toISOString(), ...extra,
  }
}

// ---------------------------------------------------------------- database (psql)
/** Runs SQL (sent on stdin as UTF-8) and returns the output: unaligned rows, no headers. Throws on any error. */
function psql(sql) {
  return execFileSync(PSQL, ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1'], {
    input: `set standard_conforming_strings = on;\n${sql}\n`,
    env: { ...process.env, PGPASSWORD: 'postgres', PGCLIENTENCODING: 'UTF8' },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}
/** An SQL string literal: quotes doubled (standard_conforming_strings is on, so a backslash is just a character). */
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuid(id) {
  if (!UUID_RE.test(id)) throw new Error(`not a uuid: ${id}`)
  return `'${id}'::uuid`
}
const pgError = (e) => String(e.stderr || e.message || e).trim().split('\n')[0]

function createDbUser(id, email) {
  psql(`insert into auth.users (id, email) values (${uuid(id)}, ${lit(email)}) on conflict do nothing`)
}

/**
 * Whether the user still has its auth.users row. When the row is gone (the app deleted the account) the user is
 * dropped here as well, so it fails like an unknown user from then on; test@local.test is re-created instead
 * (tests rely on it). If the database can't be asked, the answer is yes: nobody is dropped on a guess.
 */
function ensureLive(u) {
  let exists
  try {
    exists = psql(`select count(*) from auth.users where id = ${uuid(u.id)}`) !== '0'
  } catch (e) {
    console.warn(`[auth] could not check auth.users (${pgError(e)}); assuming ${u.email} still exists`)
    return true
  }
  if (exists) return true
  if (u.id === TEST_USER.id) {
    createDbUser(u.id, u.email)
    // its factors went with the old row: start clean so the server and auth.mfa_factors agree
    u.factors = []
    delete u.new_email
    for (const s of sessions.values()) if (s.userId === u.id) dropMfaClaims(s)
    saveUsers()
    console.log(`[auth] ${u.email} was missing from auth.users: re-created`)
    return true
  }
  dropUser(u)
  return false
}
function dropUser(u) {
  users.delete(u.email)
  for (const [id, s] of sessions) if (s.userId === u.id) sessions.delete(id)
  for (const [h, l] of links) if (l.userId === u.id) links.delete(h)
  for (const [id, c] of challenges) if (c.userId === u.id) challenges.delete(id)
  saveUsers()
  console.log(`[auth] ${u.email} no longer exists in auth.users (account deleted): removed`)
}
/** Whether another account already uses this address (here, or straight in auth.users). */
function emailTaken(email, exceptId) {
  const other = users.get(email)
  if (other && other.id !== exceptId && ensureLive(other)) return true
  try {
    return psql(`select count(*) from auth.users where lower(email) = lower(${lit(email)}) and id <> ${uuid(exceptId)}`) !== '0'
  } catch (e) {
    console.warn(`[auth] could not check auth.users (${pgError(e)})`)
    return false
  }
}

// ---------------------------------------------------------------- TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30 s steps)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32(buf) {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) out += B32[(value >>> (bits -= 5)) & 31]
  }
  return bits ? out + B32[(value << (5 - bits)) & 31] : out
}
function unbase32(s) {
  const out = []
  let bits = 0
  let value = 0
  for (const c of String(s).toUpperCase().replace(/[\s=]/g, '')) {
    const i = B32.indexOf(c)
    if (i < 0) throw new Error('invalid base32')
    value = ((value << 5) | i) & 0xffff
    bits += 5
    if (bits >= 8) out.push((value >>> (bits -= 8)) & 255)
  }
  return Buffer.from(out)
}
function totpCode(secret, step) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest()
  return String((h.readUInt32BE(h[h.length - 1] & 15) & 0x7fffffff) % 1e6).padStart(6, '0')
}
/** Like Supabase: the code of the current 30-second step, or of the step before or after (clock drift). */
function totpValid(secret, code) {
  const c = String(code ?? '').trim()
  if (!/^\d{6}$/.test(c)) return false
  const now = Math.floor(Date.now() / 30_000)
  return [now - 1, now, now + 1].some((step) => crypto.timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(c)))
}
// like Go's url.PathEscape (what Supabase uses), so "@" and ":" stay readable in the otpauth:// URI
const uriPart = (s) => encodeURIComponent(s).replace(/%40/g, '@').replace(/%3A/gi, ':')

// ---------------------------------------------------------------- QR code
// Supabase returns the otpauth:// URI as an SVG QR code too (totp.qr_code). A small encoder instead of a dependency:
// byte mode, error correction level M, versions 1-40 (ISO/IEC 18004, built like Project Nayuki's QR Code generator),
// drawn as one SVG path with the standard 4-module quiet zone.
const QR_ECC_LEN = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
/** All codewords (data + error correction) that fit in a version. */
function qrCodewords(v) {
  let bits = (16 * v + 128) * v + 64
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2
    bits -= (25 * n - 10) * n - 55
    if (v >= 7) bits -= 36
  }
  return Math.floor(bits / 8)
}
/** Multiplication in GF(2^8) with the QR polynomial 0x11d. */
function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) z = (z << 1) ^ ((z >>> 7) * 0x11d) ^ (((y >>> i) & 1) * x)
  return z
}
/** Reed-Solomon error correction codewords for one block. */
function qrEcc(data, len) {
  const gen = new Array(len).fill(0) // (x - 1)(x - 2)(x - 4)… without its leading 1
  gen[len - 1] = 1
  for (let i = 0, root = 1; i < len; i++, root = gfMul(root, 2)) {
    for (let j = 0; j < len; j++) gen[j] = gfMul(gen[j], root) ^ (j + 1 < len ? gen[j + 1] : 0)
  }
  const rem = new Array(len).fill(0)
  for (const b of data) {
    const factor = b ^ rem.shift()
    rem.push(0)
    for (let j = 0; j < len; j++) rem[j] ^= gfMul(gen[j], factor)
  }
  return rem
}
function qrPenalty(m) {
  const n = m.length
  let score = 0
  let dark = 0
  const lines = []
  for (let i = 0; i < n; i++) lines.push(m[i], m.map((row) => row[i]))
  for (const line of lines) {
    for (let i = 0; i < n; ) {
      let j = i
      while (j < n && line[j] === line[i]) j++
      if (j - i >= 5) score += j - i - 2
      i = j
    }
    const s = line.map(Number).join('')
    for (const pattern of ['10111010000', '00001011101']) for (let k = s.indexOf(pattern); k >= 0; k = s.indexOf(pattern, k + 1)) score += 40
  }
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  }
  for (const row of m) for (const c of row) if (c) dark++
  return score + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
}
/** The QR code for a text as rows of booleans (true = dark). */
function qrMatrix(text) {
  const bytes = [...Buffer.from(text, 'utf8')]
  const dataBits = (v) => (qrCodewords(v) - QR_ECC_LEN[v] * QR_BLOCKS[v]) * 8
  let v = 1
  while (4 + (v < 10 ? 8 : 16) + 8 * bytes.length > dataBits(v)) if (++v > 40) throw new Error('QR code: text too long')

  // the data: byte mode, length, bytes, terminator, padding
  const bits = []
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, dataBits(v) - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < dataBits(v); pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // split into blocks, add error correction, interleave
  const total = qrCodewords(v)
  const nBlocks = QR_BLOCKS[v]
  const eccLen = QR_ECC_LEN[v]
  const nShort = nBlocks - (total % nBlocks)
  const shortLen = Math.floor(total / nBlocks)
  const blocks = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, (k += shortLen - eccLen + (i < nShort ? 0 : 1)))
    blocks.push({ dat, ecc: qrEcc(dat, eccLen) })
  }
  const codewords = []
  for (let i = 0; i <= shortLen - eccLen; i++) for (const b of blocks) if (i < b.dat.length) codewords.push(b.dat[i])
  for (let i = 0; i < eccLen; i++) for (const b of blocks) codewords.push(b.ecc[i])

  // function patterns: timing, finders, alignment, format and version information
  const size = 4 * v + 17
  const dark = Array.from({ length: size }, () => new Array(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = (x, y, d) => {
    dark[y][x] = d
    reserved[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    fn(6, i, i % 2 === 0)
    fn(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (cx + dx >= 0 && cx + dx < size && cy + dy >= 0 && cy + dy < size) fn(cx + dx, cy + dy, d !== 2 && d !== 4)
      }
    }
  }
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue // the finder corners
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  const drawFormat = (mask) => {
    let rem = mask // level M is 00
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((mask << 10) | rem) ^ 0x5412
    const bit = (i) => ((b >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) fn(8, i, bit(i))
    fn(8, 7, bit(6))
    fn(8, 8, bit(7))
    fn(7, 8, bit(8))
    for (let i = 9; i < 15; i++) fn(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) fn(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) fn(8, size - 15 + i, bit(i))
    fn(8, size - 8, true)
  }
  drawFormat(0)
  if (v >= 7) {
    let rem = v
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (v << 12) | rem
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) === 1
      fn(size - 11 + (i % 3), Math.floor(i / 3), d)
      fn(Math.floor(i / 3), size - 11 + (i % 3), d)
    }
  }

  // the codewords, in the zigzag order (two columns at a time from the right, skipping the vertical timing line)
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!reserved[y][x] && k < codewords.length * 8) {
          dark[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1
          k++
        }
      }
    }
  }

  // the mask that leaves the fewest scanner-unfriendly patterns
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y][x] && MASKS[mask](x, y)) dark[y][x] = !dark[y][x]
  }
  let best = 0
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const score = qrPenalty(dark)
    if (score < bestScore) [best, bestScore] = [mask, score]
    applyMask(mask) // undo
  }
  applyMask(best)
  drawFormat(best)
  return dark
}
/** The SVG, Supabase-style: plain markup without "#", which the client turns into a data: URL. */
function qrSvg(text) {
  const m = qrMatrix(text)
  const q = 4
  const n = m.length + 2 * q
  let d = ''
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let w = 1
      while (row[x + w]) w++
      d += `M${x + q} ${y + q}h${w}v1h-${w}z`
      x += w - 1
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n * 4}" height="${n * 4}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="white"/><path d="${d}" fill="black"/></svg>`
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
/**
 * session id → { userId, refresh, amr: [{ method, timestamp }] (newest first), factorId }
 * Like Supabase, a session is aal2 once it holds a second-factor claim (totp) and aal1 before; every token minted
 * for it (sign-in, refresh, verify) carries its aal and amr. Refreshing keeps both.
 */
const sessions = new Map()
const MFA_METHODS = ['totp', 'mfa/phone', 'mfa/webauthn']
const aalOf = (s) => (s.amr.some((c) => MFA_METHODS.includes(c.method)) ? 'aal2' : 'aal1')
const newRefreshToken = () => crypto.randomBytes(16).toString('hex')
function addClaim(s, method) {
  s.amr = [{ method, timestamp: Math.floor(Date.now() / 1000) }, ...s.amr.filter((c) => c.method !== method)]
}
function dropMfaClaims(s) {
  s.amr = s.amr.filter((c) => !MFA_METHODS.includes(c.method))
  s.factorId = null
}
/** method: how the user signed in, as in Supabase's amr ('password', or 'otp' for an email link) */
function newSession(u, method, weak) {
  const id = crypto.randomUUID()
  const s = { userId: u.id, refresh: newRefreshToken(), amr: [], factorId: null }
  addClaim(s, method)
  sessions.set(id, s)
  return sessionFor(u, id, weak)
}
function sessionFor(u, sessionId, weak) {
  const s = sessions.get(sessionId)
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600
  const access_token = jwt({
    iss: `http://127.0.0.1:${PORT}/auth/v1`, sub: u.id, aud: 'authenticated', exp, iat: now, email: u.email, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, role: 'authenticated',
    aal: aalOf(s), amr: s.amr, session_id: sessionId, is_anonymous: false,
  })
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: s.refresh, user: userObject(u), ...(weak?.length ? { weak_password: { reasons: weak } } : {}) }
}
function bearer(req) {
  const claims = readJwt((req.headers.authorization ?? '').replace(/^Bearer /i, ''))
  const s = claims && sessions.get(claims.session_id)
  if (!s) return null
  const u = byId(claims.sub)
  return u ? { u, s, claims } : null
}

// ---------------------------------------------------------------- email links + outbox
/** token hash → { userId, type, newEmail, expires, used } */
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
function sendMail(template, u, { type, newEmail, redirectTo = SITE_URL, oldEmail, to } = {}) {
  let tokenHash = ''
  if (type) {
    const group = (t) => (['email', 'signup', 'magiclink'].includes(t) ? 'confirm' : t)
    for (const [h, l] of links) if (l.userId === u.id && group(l.type) === group(type)) links.delete(h) // older link of the same kind stops working
    tokenHash = crypto.createHash('sha224').update(crypto.randomBytes(32)).digest('hex')
    links.set(tokenHash, { userId: u.id, type, newEmail, expires: Date.now() + LINK_TTL_MS, used: false })
  }
  const token = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
  const vars = {
    SiteURL: SITE_URL, TokenHash: tokenHash, Token: token, Email: u.email, NewEmail: newEmail ?? '', OldEmail: oldEmail ?? '', RedirectTo: redirectTo, Data: '{}',
    ConfirmationURL: `${SITE_URL}/auth/confirm?token_hash=${tokenHash}&type=${type}`,
  }
  const { subject, html } = render(template, vars)
  const mail = { id: outbox.length + 1, at: new Date().toISOString(), to: to ?? newEmail ?? u.email, template, subject, html, link: type ? vars.ConfirmationURL : null }
  outbox.push(mail)
  console.log(`[mail] ${mail.to} · ${subject}${mail.link ? ` · ${mail.link}` : ''}`)
}
// Simplification: with secure email change (on in production) Supabase mails a link to BOTH the old and the new
// address and only changes the email once both were opened (the first one answers {msg: "Confirmation link accepted.
// Please proceed to confirm link sent to the other email"} and no session). Locally a single link goes to the new
// address, and opening it completes the change.
function sendEmailChange(u, newEmail, redirectTo = SITE_URL) {
  u.new_email = newEmail
  u.email_change_sent_at = new Date().toISOString()
  saveUsers()
  sendMail('email_change', u, { type: 'email_change', newEmail, redirectTo })
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
    let existing = users.get(email)
    if (existing && !ensureLive(existing)) existing = undefined // that account was deleted: the address is free again
    if (existing?.confirmed_at) {
      // like Supabase: a look-alike answer, no email, so nobody can tell the address is registered
      return json(res, 200, { ...userObject({ id: crypto.randomUUID(), email: existing.email, confirmed_at: null, created_at: existing.created_at }), identities: [] })
    }
    const u = existing ?? { id: crypto.randomUUID(), email, confirmed_at: null, created_at: new Date().toISOString() }
    setPassword(u, body.password)
    if (!existing) {
      // local convenience: an auth.users row with this address that no account here knows (e.g. auth-users.json was
      // reset but the database kept) is taken over, so the new account and that row's data work together
      const orphan = psql(`select id from auth.users where lower(email) = lower(${lit(email)}) limit 1`)
      if (UUID_RE.test(orphan) && !byId(orphan)) u.id = orphan
      else createDbUser(u.id, email)
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
      // a deleted account (its auth.users row is gone) fails exactly like an unknown one
      if (!u || !checkPassword(u, String(body.password ?? '')) || !ensureLive(u)) return fail(res, 400, 'invalid_credentials', 'Invalid login credentials', { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      if (!u.confirmed_at) return fail(res, 400, 'email_not_confirmed', 'Email not confirmed')
      // with a verified factor this is still an aal1 session: the app asks for the code next (challenge + verify → aal2)
      return json(res, 200, newSession(u, 'password', u.email === TEST_USER.email ? [] : weakReasons(body.password)))
    }
    if (grant === 'refresh_token') {
      const found = [...sessions.entries()].find(([, s]) => s.refresh === body.refresh_token)
      const u = found && byId(found[1].userId)
      if (!u || !ensureLive(u)) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
      const [id, s] = found
      s.refresh = newRefreshToken() // rotation; the session keeps its aal and amr
      return json(res, 200, sessionFor(u, id))
    }
    return fail(res, 400, 'validation_failed', 'unsupported grant_type')
  }

  if (p === 'resend') {
    const u = users.get(email)
    if (u && !u.confirmed_at && body.type === 'signup' && ensureLive(u)) sendMail('confirmation', u, { type: 'email' })
    if (u?.new_email && body.type === 'email_change' && ensureLive(u)) sendEmailChange(u, u.new_email)
    return json(res, 200, {})
  }

  if (p === 'recover') {
    const u = users.get(email)
    if (u && ensureLive(u)) sendMail('recovery', u, { type: 'recovery', redirectTo: url.searchParams.get('redirect_to') ?? SITE_URL })
    return json(res, 200, {})
  }

  if (p === 'verify') {
    const link = links.get(body.token_hash)
    const typeOk = link && (link.type === body.type || (['email', 'signup', 'magiclink'].includes(link.type) && ['email', 'signup', 'magiclink'].includes(body.type)))
    if (!link || link.used || link.expires < Date.now() || !typeOk) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
    const u = byId(link.userId)
    if (!u || !ensureLive(u)) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
    if (link.type === 'email_change') {
      // (one link, to the new address: see sendEmailChange)
      if (u.new_email !== link.newEmail) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
      if (emailTaken(link.newEmail, u.id)) return fail(res, 422, 'email_exists', DUPLICATE_EMAIL)
      psql(`update auth.users set email = ${lit(link.newEmail)} where id = ${uuid(u.id)}`)
      link.used = true
      const oldEmail = u.email
      users.delete(oldEmail)
      u.email = link.newEmail
      delete u.new_email
      if (!u.confirmed_at) u.confirmed_at = new Date().toISOString()
      users.set(u.email, u)
      saveUsers()
      sendMail('email_changed_notification', u, { oldEmail, to: oldEmail }) // like Supabase: the notice goes to the old address
      return json(res, 200, newSession(u, 'otp'))
    }
    link.used = true
    if (!u.confirmed_at) u.confirmed_at = new Date().toISOString()
    saveUsers()
    return json(res, 200, newSession(u, 'otp'))
  }

  if (p === 'user' && req.method === 'GET') {
    const who = bearer(req)
    return who ? json(res, 200, userObject(who.u)) : fail(res, 401, 'session_not_found', 'Session not found')
  }

  if (p === 'user' && req.method === 'PUT') {
    const who = bearer(req)
    if (!who) return fail(res, 401, 'session_not_found', 'Session not found')
    const u = who.u
    const changeEmail = email !== '' && email !== u.email
    const changePassword = body.password !== undefined
    // every check first, so a rejected request changes nothing (Supabase updates the user in one transaction)
    if (changeEmail && !EMAIL_RE.test(email)) return fail(res, 400, 'email_address_invalid', `Email address "${email}" is invalid`)
    const weak = changePassword ? weakReasons(body.password) : []
    if (weak.length) return fail(res, 422, 'weak_password', 'Password should be at least 8 characters and contain lowercase, uppercase letters and digits.', { weak_password: { reasons: weak } })
    // like Supabase: once the user has a verified factor, email and password can only be changed from an aal2 session
    if ((changeEmail || changePassword) && u.factors?.some((f) => f.status === 'verified') && aalOf(who.s) !== 'aal2') {
      return fail(res, 401, 'insufficient_aal', 'AAL2 session is required to update email or password when MFA is enabled.')
    }
    if (changeEmail) {
      if (u.id === TEST_USER.id) return fail(res, 422, 'validation_failed', `${TEST_USER.email} is the local test account and keeps its address: sign up another account to try an email change`)
      if (emailTaken(email, u.id)) return fail(res, 422, 'email_exists', DUPLICATE_EMAIL)
    }
    if (changePassword) {
      if (u.hash && checkPassword(u, body.password)) return fail(res, 422, 'same_password', 'New password should be different from the old password.')
      setPassword(u, body.password)
      saveUsers()
      sendMail('password_changed_notification', u)
    }
    if (changeEmail) sendEmailChange(u, email, url.searchParams.get('redirect_to') ?? SITE_URL)
    return json(res, 200, userObject(u))
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

  const factorRoute = p.match(/^factors(?:\/([^/]+)(?:\/(challenge|verify))?)?$/)
  if (factorRoute) {
    const who = bearer(req)
    if (!who) return fail(res, 401, 'session_not_found', 'Session not found')
    return factors(req, res, who, factorRoute[1], factorRoute[2], body)
  }

  return fail(res, 404, 'not_found', `local auth: ${req.method} ${p} is not implemented`)
}

// ---------------------------------------------------------------- two-step sign-in (TOTP), Supabase's /factors API
/** challenge id → { factorId, userId, ip, created (ms), verified } */
const challenges = new Map()

function factors(req, res, who, factorId, action, body) {
  const { u, s } = who
  // like Supabase, whose auth middleware loads the user first: a deleted account gets nothing here
  if (!ensureLive(u)) return fail(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist')
  u.factors ??= []
  const notImplemented = () => fail(res, 404, 'not_found', `local auth: ${req.method} ${req.url} is not implemented`)

  // POST /factors: add a new (unverified) factor
  if (!factorId) {
    if (req.method !== 'POST') return notImplemented()
    const type = body.factor_type
    if (type === 'phone') return fail(res, 422, 'mfa_phone_enroll_not_enabled', 'MFA enroll is disabled for Phone')
    if (type === 'webauthn') return fail(res, 422, 'mfa_webauthn_enroll_not_enabled', 'MFA enroll is disabled for WebAuthn')
    if (type !== 'totp') return fail(res, 400, 'validation_failed', 'factor_type needs to be totp, phone, or webauthn')
    const name = String(body.friendly_name ?? '')
    const expired = u.factors.filter((f) => f.status !== 'verified' && !f.last_challenged_at && Date.parse(f.created_at) + UNVERIFIED_FACTOR_TTL_MS < Date.now())
    if (expired.length) {
      psql(`delete from auth.mfa_factors where id in (${expired.map((f) => uuid(f.id)).join(', ')})`)
      u.factors = u.factors.filter((f) => !expired.includes(f))
      saveUsers()
    }
    if (name.trim() && u.factors.some((f) => f.friendly_name === name)) return fail(res, 422, 'mfa_factor_name_conflict', `A factor with the friendly name "${name}" for this user already exists`)
    if (u.factors.length >= MAX_FACTORS) return fail(res, 422, 'too_many_enrolled_mfa_factors', 'Maximum number of verified factors reached, unenroll to continue')
    if (u.factors.some((f) => f.status === 'verified') && aalOf(s) !== 'aal2') return fail(res, 403, 'insufficient_aal', 'AAL2 required to enroll a new factor')
    const issuer = String(body.issuer || new URL(SITE_URL).host)
    const secret = base32(crypto.randomBytes(20))
    const uri = `otpauth://totp/${uriPart(issuer)}:${uriPart(u.email)}?algorithm=SHA1&digits=6&issuer=${uriPart(issuer)}&period=30&secret=${secret}`
    const now = new Date().toISOString()
    const f = { id: crypto.randomUUID(), friendly_name: name, factor_type: 'totp', status: 'unverified', secret, created_at: now, updated_at: now, last_challenged_at: null }
    psql(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)
          values (${uuid(f.id)}, ${uuid(u.id)}, ${lit(name)}, 'totp', 'unverified', ${lit(secret)}, ${lit(now)}, ${lit(now)})`)
    u.factors.push(f)
    saveUsers()
    return json(res, 200, { id: f.id, type: 'totp', friendly_name: name, totp: { qr_code: qrSvg(uri), secret, uri } })
  }

  if (!UUID_RE.test(factorId)) return fail(res, 404, 'validation_failed', 'factor_id must be an UUID')
  const f = u.factors.find((x) => x.id === factorId)
  if (!f) return fail(res, 404, 'mfa_factor_not_found', 'Factor not found')

  // POST /factors/:id/challenge
  if (action === 'challenge' && req.method === 'POST') {
    for (const [id, c] of challenges) if (c.created + 10 * CHALLENGE_TTL_S * 1000 < Date.now()) challenges.delete(id)
    const c = { id: crypto.randomUUID(), factorId: f.id, userId: u.id, ip: req.socket.remoteAddress, created: Date.now(), verified: false }
    challenges.set(c.id, c)
    f.last_challenged_at = new Date(c.created).toISOString()
    saveUsers()
    return json(res, 200, { id: c.id, type: f.factor_type, expires_at: Math.floor(c.created / 1000) + CHALLENGE_TTL_S })
  }

  // POST /factors/:id/verify {challenge_id, code} → the same session, now aal2
  if (action === 'verify' && req.method === 'POST') {
    const c = challenges.get(body.challenge_id)
    if (!c || c.factorId !== f.id) return fail(res, 422, 'mfa_factor_not_found', 'MFA factor with the provided challenge ID not found')
    if (c.verified || c.ip !== req.socket.remoteAddress) return fail(res, 422, 'mfa_ip_address_mismatch', 'Challenge and verify IP addresses mismatch.')
    if (c.created + CHALLENGE_TTL_S * 1000 < Date.now()) {
      challenges.delete(c.id)
      return fail(res, 422, 'mfa_challenge_expired', `MFA challenge ${c.id} has expired, verify against another challenge or create a new challenge.`)
    }
    if (!totpValid(f.secret, body.code)) return fail(res, 422, 'mfa_verification_failed', 'Invalid TOTP code entered')

    const now = new Date().toISOString()
    const firstTime = f.status !== 'verified'
    const unverified = u.factors.filter((x) => x !== f && x.status !== 'verified' && x.factor_type === f.factor_type) // like Supabase: removed on verify
    if (firstTime || unverified.length) {
      // the database first: if this fails, nothing changes here either
      const statements = []
      if (firstTime) {
        statements.push(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at)
          values (${uuid(f.id)}, ${uuid(u.id)}, ${lit(f.friendly_name)}, ${lit(f.factor_type)}, 'verified', ${lit(f.secret)}, ${lit(f.created_at)}, ${lit(now)})
          on conflict (id) do update set status = 'verified', updated_at = excluded.updated_at;`)
      }
      if (unverified.length) statements.push(`delete from auth.mfa_factors where id in (${unverified.map((x) => uuid(x.id)).join(', ')});`)
      psql(statements.join('\n'))
    }
    c.verified = true
    if (firstTime) Object.assign(f, { status: 'verified', updated_at: now })
    u.factors = u.factors.filter((x) => !unverified.includes(x))
    for (const [id, x] of challenges) if (unverified.some((y) => y.id === x.factorId)) challenges.delete(id)
    saveUsers()
    addClaim(s, f.factor_type)
    s.factorId = f.id
    s.refresh = newRefreshToken() // Supabase hands out a new refresh token with the upgraded session
    // like Supabase: the user's other sessions that are still aal1 end here
    for (const [id, other] of sessions) if (other !== s && other.userId === u.id && aalOf(other) === 'aal1') sessions.delete(id)
    return json(res, 200, sessionFor(u, who.claims.session_id))
  }

  // DELETE /factors/:id
  if (!action && req.method === 'DELETE') {
    if (f.status === 'verified' && aalOf(s) !== 'aal2') return fail(res, 422, 'insufficient_aal', 'AAL2 required to unenroll verified factor')
    psql(`delete from auth.mfa_factors where id = ${uuid(f.id)}`)
    u.factors = u.factors.filter((x) => x !== f)
    for (const [id, c] of challenges) if (c.factorId === f.id) challenges.delete(id)
    // like Supabase: sessions that reached aal2 with this factor are aal1 again (from their next token on)
    if (f.status === 'verified') for (const other of sessions.values()) if (other.factorId === f.id) dropMfaClaims(other)
    saveUsers()
    return json(res, 200, { id: f.id })
  }

  return notImplemented()
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
