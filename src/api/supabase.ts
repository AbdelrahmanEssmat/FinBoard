import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/api/database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)
export const isLocalStack = Boolean(url && /127\.0\.0\.1|localhost/.test(url))

export const supabase = createClient<Database>(url ?? 'http://127.0.0.1:1', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** True when the error looks like a lost connection rather than a rejected request. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: string })?.message ?? ''
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNREFUSED|timeout/i.test(msg)
}
