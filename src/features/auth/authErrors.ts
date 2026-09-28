/**
 * Supabase Auth errors in plain words. Matches on the error code first (stable), then on the
 * message (older servers, network errors).
 */
const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  email_not_confirmed: 'Please confirm your email first: open the link we sent you (check spam too).',
  user_already_exists: 'An account with this email already exists. Sign in, or reset your password.',
  email_exists: 'An account with this email already exists. Sign in, or reset your password.',
  weak_password: 'That password is too weak. Use at least 8 characters with uppercase, lowercase and a number.',
  same_password: 'Your new password must be different from the current one.',
  over_email_send_rate_limit: 'Too many emails were sent just now. Please wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a few minutes and try again.',
  otp_expired: 'This link has expired or was already used. Ask for a new one.',
  otp_disabled: 'This link can no longer be used. Ask for a new one.',
  flow_state_expired: 'This link has expired. Ask for a new one.',
  email_address_invalid: 'That email address doesn’t look right.',
  email_address_not_authorized: 'Emails can’t be sent to this address yet (the app’s email service isn’t set up). Ask the app owner.',
  signup_disabled: 'New accounts are closed right now.',
  reauthentication_needed: 'For your security, sign in again before changing your password.',
  session_expired: 'Your session expired. Please sign in again.',
  session_not_found: 'Your session expired. Please sign in again.',
  user_banned: 'This account is suspended.',
}

export function authMessage(err: unknown): string {
  const e = (err ?? {}) as { code?: string; message?: string; name?: string }
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]!
  const m = e.message ?? (typeof err === 'string' ? err : '')
  if (/invalid login credentials/i.test(m)) return BY_CODE.invalid_credentials!
  if (/email not confirmed/i.test(m)) return BY_CODE.email_not_confirmed!
  if (/already registered|already exists/i.test(m)) return BY_CODE.user_already_exists!
  if (/rate limit|too many/i.test(m)) return BY_CODE.over_request_rate_limit!
  if (/password should (be|contain)|weak/i.test(m)) return BY_CODE.weak_password!
  if (/different from the old password/i.test(m)) return BY_CODE.same_password!
  if (/otp_expired|expired|invalid.*(link|token)|token.*(invalid|expired)/i.test(m)) return BY_CODE.otp_expired!
  if (/failed to fetch|network|load failed/i.test(m)) return 'Can’t reach the server. Check your internet connection and try again.'
  return m || 'Something went wrong. Please try again.'
}
