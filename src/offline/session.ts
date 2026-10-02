/**
 * Who is signed in, for the offline layer. Several people can use FinBoard on the same phone, so
 * everything kept on the device belongs to one of them:
 *  - queued offline changes are stamped with their user and only ever sent for that user;
 *  - the saved copy of the data (for offline use) is dropped when a different person signs in.
 */

let currentUserId: string | null = null
/** while the signed-in person still owes their second sign-in step, nothing queued is sent (it would be refused and lost) */
let sendingPaused = false
export function setSendingPaused(paused: boolean) {
  sendingPaused = paused
}
export function isSendingPaused(): boolean {
  return sendingPaused
}
const OWNER_KEY = 'finboard-device-data-owner'

export function setCurrentUserId(id: string | null) {
  currentUserId = id
}
export function getCurrentUserId(): string | null {
  return currentUserId
}

/** The user whose data is currently saved on this device (null before anyone signed in). */
export function getDeviceDataOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}
export function setDeviceDataOwner(id: string | null) {
  try {
    if (id) localStorage.setItem(OWNER_KEY, id)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    /* private mode */
  }
}

/**
 * Whether a queued change belongs to the signed-in user. Changes queued before stamping existed
 * belong to whoever owned the device's data then.
 */
export function isMine(entryUserId: string | undefined): boolean {
  if (!currentUserId) return false
  if (entryUserId) return entryUserId === currentUserId
  const owner = getDeviceDataOwner()
  return !owner || owner === currentUserId
}
