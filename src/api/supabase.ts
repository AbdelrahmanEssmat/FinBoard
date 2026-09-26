import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Connection settings. Environment variables win (that is how the local stand-in in dev-local/
 * is selected); otherwise the app falls back to the production project so a hosted build works
 * even when the host's build-time variables are missing. The publishable key is public by design;
 * every table is protected by Row Level Security.
 */
const PRODUCTION = {
  url: 'https://qddbhmiqsolhnzduvswt.supabase.co',
  anonKey: 'sb_publishable_27vP6q8OGwDJAE3tXkPaNw_xJlVDteZ',
}

const env = import.meta.env as Record<string, string | undefined>
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || PRODUCTION.url
const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || PRODUCTION.anonKey

export const isConfigured = Boolean(url && anonKey && !/PASTE|your-anon|YOUR-PROJECT/i.test(url + anonKey))
export const isLocalStack = /127\.0\.0\.1|localhost/.test(url)

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** True when the error looks like a lost connection rather than a rejected request. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ((err as { message?: string })?.message ?? '')
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNREFUSED|timeout/i.test(msg)
}
