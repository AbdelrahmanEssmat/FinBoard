import { supabase } from '@/api/supabase'

/**
 * Crash reports: unexpected errors on anyone's device are sent to the app_errors table, which only
 * the owner can read (Supabase dashboard → Table Editor → app_errors). Reports carry the error
 * message, where in the app it happened and the app version; never amounts or other data. At most a
 * few per session, the same message once; reports made offline (or before signing in) wait on the
 * device and go out later.
 */
const QUEUE_KEY = 'finboard-error-queue'
const MAX_PER_SESSION = 10
const MAX_QUEUED = 20
let sentThisSession = 0
const seen = new Set<string>()

interface Report {
  kind: string
  message: string
  stack: string | null
  url: string
  app_version: string
  user_agent: string
}

// browser noise that says nothing about FinBoard
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Load failed$/i, /AbortError/i, /The user aborted a request/i]

function readQueue(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Report[]
  } catch {
    return []
  }
}
function writeQueue(list: Report[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-MAX_QUEUED)))
  } catch {
    /* storage full or private mode */
  }
}

async function send(reports: Report[]): Promise<boolean> {
  if (!reports.length) return true
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const { data } = await supabase.auth.getSession()
  if (!data.session) return false
  const { error } = await supabase.from('app_errors').insert(reports)
  return !error
}

/** Send what's waiting on this device (after coming online or signing in). */
export async function flushErrorReports() {
  const queued = readQueue()
  if (!queued.length) return
  if (await send(queued).catch(() => false)) writeQueue([])
}

/** Report one error. Safe to call from anywhere; never throws. */
export function reportClientError(kind: string, error: unknown) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const message = (err.message || String(error)).slice(0, 2000)
    if (!message || IGNORE.some((re) => re.test(message))) return
    const dedupe = kind + '|' + message
    if (seen.has(dedupe) || sentThisSession >= MAX_PER_SESSION) return
    seen.add(dedupe)
    sentThisSession++
    const report: Report = {
      kind: kind.slice(0, 40),
      message,
      stack: err.stack ? err.stack.slice(0, 8000) : null,
      // the page, without query strings (no ids from links)
      url: location.pathname.slice(0, 500),
      app_version: (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev').slice(0, 40),
      user_agent: navigator.userAgent.slice(0, 500),
    }
    void send([report])
      .then((ok) => {
        if (!ok) writeQueue([...readQueue(), report])
      })
      .catch(() => writeQueue([...readQueue(), report]))
  } catch {
    /* reporting must never break the app */
  }
}

let installed = false
/** Catch uncaught errors and unhandled promise rejections everywhere. */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => reportClientError('error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportClientError('promise', e.reason))
  window.addEventListener('online', () => void flushErrorReports())
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') void flushErrorReports()
  })
}
