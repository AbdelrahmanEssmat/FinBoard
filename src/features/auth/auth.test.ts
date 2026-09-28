import { describe, expect, it } from 'vitest'
import { isStrongPassword, newPasswordProblem, passwordChecks } from './password'
import { authMessage } from './authErrors'

describe('password rules', () => {
  it('needs 8+ characters with lower, upper and a digit', () => {
    expect(isStrongPassword('Abcdefg1')).toBe(true)
    expect(isStrongPassword('Abcdef1')).toBe(false) // 7 characters
    expect(isStrongPassword('abcdefg1')).toBe(false)
    expect(isStrongPassword('ABCDEFG1')).toBe(false)
    expect(isStrongPassword('Abcdefgh')).toBe(false)
  })

  it('lists what is missing', () => {
    expect(passwordChecks('abc').filter((c) => !c.ok).map((c) => c.id)).toEqual(['length', 'upper', 'digit'])
  })

  it('checks the confirmation only once the password itself is fine', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(/needs/)
    expect(newPasswordProblem('Abcdefg1', 'Abcdefg2')).toMatch(/don’t match/)
    expect(newPasswordProblem('Abcdefg1', 'Abcdefg1')).toBeNull()
  })
})

describe('auth error messages', () => {
  it('prefers the error code', () => {
    expect(authMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong email or password.')
    expect(authMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' })).toMatch(/expired/)
  })

  it('falls back to the message', () => {
    expect(authMessage(new Error('Email not confirmed'))).toMatch(/confirm your email/)
    expect(authMessage(new Error('Failed to fetch'))).toMatch(/internet/)
    expect(authMessage(new Error('Something odd'))).toBe('Something odd')
  })
})
