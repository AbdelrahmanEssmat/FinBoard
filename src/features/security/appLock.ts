import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * App lock: covers FinBoard when you come back to it, until Face ID / Touch ID / Windows Hello or a
 * PIN says it's you. It is a lock on this device's screen (someone picking up your unlocked phone),
 * not encryption: your data stays protected on the server by your password and sign-in code.
 * Everything here stays on the device; nothing is sent anywhere.
 */
export type LockMethod = 'none' | 'biometric' | 'pin'

interface AppLockState {
  method: LockMethod
  /** whose lock this is: a lock set up by someone else on this device doesn't apply to you */
  userId: string | null
  /** the passkey made for unlocking (base64url) */
  credentialId: string | null
  pinHash: string | null
  pinSalt: string | null
  /** seconds in the background before it locks again (0 = every time) */
  after: number
  set: (p: Partial<Omit<AppLockState, 'set' | 'clear'>>) => void
  clear: () => void
}

const OFF = { method: 'none' as LockMethod, userId: null, credentialId: null, pinHash: null, pinSalt: null, after: 60 }

export const useAppLock = create<AppLockState>()(
  persist(
    (set) => ({
      ...OFF,
      set: (p) => set(p),
      clear: () => set(OFF),
    }),
    { name: 'finboard-app-lock' },
  ),
)

/** Marks this run of the app as unlocked (e.g. right after typing the password to sign in). */
const UNLOCKED_KEY = 'finboard-unlocked'
export function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCKED_KEY, '1')
  } catch {
    /* private mode */
  }
}
export function wasUnlockedThisRun(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === '1'
  } catch {
    return false
  }
}
export function forgetUnlocked() {
  try {
    sessionStorage.removeItem(UNLOCKED_KEY)
  } catch {
    /* private mode */
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Whether this device can unlock with Face ID / Touch ID / a fingerprint / Windows Hello. */
export async function biometricAvailable(): Promise<boolean> {
  try {
    return typeof window.PublicKeyCredential !== 'undefined' && (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  } catch {
    return false
  }
}

/** Make the device passkey used to unlock (asks for Face ID / fingerprint once). Returns its id. */
export async function registerBiometric(userId: string, email: string): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'FinBoard', id: location.hostname },
      user: { id: new TextEncoder().encode(userId).slice(0, 64), name: email || 'FinBoard', displayName: email || 'FinBoard' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Face ID or fingerprint wasn’t set up.')
  return b64url(cred.rawId)
}

/** Ask for Face ID / fingerprint. True when it's you. */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const got = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return Boolean(got)
  } catch {
    return false
  }
}

/** A PIN is stored only as a slow salted hash (PBKDF2), never as typed. */
export async function hashPin(pin: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ? fromB64url(salt) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 150_000 }, key, 256)
  return { hash: b64url(bits), salt: b64url(saltBytes) }
}

export async function checkPin(pin: string, hash: string | null, salt: string | null): Promise<boolean> {
  if (!hash || !salt) return false
  return (await hashPin(pin, salt)).hash === hash
}

export const PIN_RE = /^\d{4,8}$/
