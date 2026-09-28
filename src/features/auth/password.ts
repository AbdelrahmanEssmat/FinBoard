/**
 * Password rules. They mirror the Supabase Auth settings applied by
 * scripts/configure-supabase-auth.ps1 (minimum length + required character sets), so the form can
 * say what's missing before the server rejects it.
 */
export const PASSWORD_MIN_LENGTH = 8

export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'digit'
  label: string
  /** the same, inside a sentence: "Your password needs: …" */
  need: string
  test: (pw: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: `${PASSWORD_MIN_LENGTH}+ characters`, need: `at least ${PASSWORD_MIN_LENGTH} characters`, test: (pw) => [...pw].length >= PASSWORD_MIN_LENGTH },
  { id: 'lower', label: 'Lowercase letter', need: 'a lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'upper', label: 'Uppercase letter', need: 'an uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'digit', label: 'Number', need: 'a number', test: (pw) => /[0-9]/.test(pw) },
]

export function passwordChecks(pw: string) {
  return PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(pw) }))
}

export function isStrongPassword(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(pw))
}

/** The first problem with a new password + its confirmation, or null when it's good to send. */
export function newPasswordProblem(pw: string, confirm: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.test(pw))
  if (missing.length) return `Your password needs: ${missing.map((r) => r.need).join(', ')}.`
  if (pw !== confirm) return 'The passwords don’t match.'
  return null
}
