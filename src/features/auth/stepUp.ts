import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { supabase, supabaseAnonKey, supabaseUrl } from '@/api/supabase'
import type { Database } from '@/api/database.types'

/** Thrown when the password is right but the second sign-in step is on and no code was given. */
export class CodeNeededError extends Error {
  constructor() {
    super('Enter the 6-digit code from your authenticator app.')
  }
}

/** Whether this person has turned on the second sign-in step (an authenticator app). */
export function hasSecondStep(session: Session | null): boolean {
  return Boolean(session?.user.factors?.some((f) => f.factor_type === 'totp' && f.status === 'verified'))
}

/** The assurance level of a session's access token ('aal1' after a password, 'aal2' after the code). */
export function sessionLevel(session: Session | null): 'aal1' | 'aal2' | null {
  if (!session) return null
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { aal?: string }
    return payload.aal === 'aal2' ? 'aal2' : 'aal1'
  } catch {
    return 'aal1'
  }
}

/**
 * Prove it's really you before something sensitive (new password or email, deleting the account):
 * the password (and the code when the second step is on) are checked on a separate, throwaway
 * connection, so the app's own session is never replaced or downgraded on the way. Returns that
 * freshly signed-in connection; the caller makes the sensitive change with it.
 */
export async function stepUp(email: string, password: string, code?: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'finboard-step-up' },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error.code === 'invalid_credentials' || /invalid login/i.test(error.message) ? new Error('Your password is wrong.') : error
  const { data: level } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (level && level.nextLevel === 'aal2' && level.currentLevel !== 'aal2') {
    if (!code?.trim()) throw new CodeNeededError()
    await verifyCode(client, code)
  }
  return client
}

/** Pass the second step on a connection (the app's own one, or a step-up connection). */
export async function verifyCode(client: SupabaseClient<Database> = supabase, code: string): Promise<void> {
  const { data: factors, error: listError } = await client.auth.mfa.listFactors()
  if (listError) throw listError
  const factor = factors?.totp[0]
  if (!factor) throw new Error('No authenticator app is set up for this account.')
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') })
  if (error) throw new Error(/invalid|verification|expired/i.test(error.message) ? 'That code isn’t right. Codes change every 30 seconds: try the current one.' : error.message)
}
