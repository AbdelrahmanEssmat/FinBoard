import { isNetworkError } from '@/api/supabase'

/**
 * What a failed request means for a queued change:
 *  - network: the request never reached the server; keep it and retry when back online;
 *  - permanent: the server understood and refused it (a rule, a missing row, a permission);
 *    retrying can't help, so it is dropped and the screen is refreshed to the server's truth;
 *  - transient: anything else (a server hiccup); retried a few times.
 */
export type ErrorKind = 'network' | 'permanent' | 'transient'

export function classifyError(err: unknown): ErrorKind {
  if (isNetworkError(err)) return 'network'
  const e = (err ?? {}) as { code?: unknown; status?: unknown }
  // Postgres (23505, 42501…) and PostgREST (PGRST…) errors carry a code; auth errors too
  if (typeof e.code === 'string' && e.code) return 'permanent'
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) return 'permanent'
  return 'transient'
}
