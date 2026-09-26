import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'

const KEY = 'finance-tracker-query-cache'

/** Persists the TanStack Query cache in IndexedDB so the last-known data is available offline and after reloads. */
export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await set(KEY, client)
    } catch {
      /* storage unavailable (private mode) */
    }
  },
  restoreClient: async () => {
    try {
      return (await get<PersistedClient>(KEY)) ?? undefined
    } catch {
      return undefined
    }
  },
  removeClient: async () => {
    try {
      await del(KEY)
    } catch {
      /* ignore */
    }
  },
}
