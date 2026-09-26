// Tiny local stand-in for Supabase (dev only): fake GoTrue auth + proxy to PostgREST.
// Usage: node dev-local/server.mjs   → http://127.0.0.1:54321
import http from 'node:http'
import crypto from 'node:crypto'

const PORT = 54321
const POSTGREST = 'http://127.0.0.1:3001'
const SECRET = 'local-dev-jwt-secret-please-do-not-use-in-production-0123456789'
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'test@local.test' }

const b64 = (s) => Buffer.from(s).toString('base64url')
function jwt(claims) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}
function session() {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600
  const access_token = jwt({ sub: USER.id, role: 'authenticated', email: USER.email, aud: 'authenticated', iat: now, exp })
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: crypto.randomBytes(16).toString('hex'),
    user: userObject(),
  }
}
function userObject() {
  return {
    id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email,
    email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), identities: [],
  }
}
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }

  if (url.pathname.startsWith('/auth/v1/')) {
    const p = url.pathname.slice('/auth/v1/'.length)
    if (p === 'token' || p === 'signup' || p === 'otp' || p === 'verify') return json(res, 200, session())
    if (p === 'user' && req.method === 'GET') return json(res, 200, userObject())
    if (p === 'logout') { res.writeHead(204, cors); return res.end() }
    if (p === 'health') return json(res, 200, { name: 'local-auth' })
    return json(res, 200, {})
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

  if (url.pathname.startsWith('/realtime/')) { res.writeHead(404, cors); return res.end() }
  json(res, 404, { message: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => console.log(`local supabase stand-in on http://127.0.0.1:${PORT}`))
