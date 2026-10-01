import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
  /** Undo callback; shown as a button while the toast is visible */
  undo?: () => void
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let seq = 1
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = seq++
    const toast: Toast = { id, duration: t.undo ? 6000 : 3000, ...t }
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }))
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), toast.duration)
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  info: (message: string) => useToasts.getState().push({ message, kind: 'info' }),
  success: (message: string) => useToasts.getState().push({ message, kind: 'success' }),
  error: (message: string) => useToasts.getState().push({ message, kind: 'error' }),
  undoable: (message: string, undo: () => void) => useToasts.getState().push({ message, kind: 'info', undo }),
}

/** Deletes still inside their undo window, each with a function that sends it now. */
const pendingDeletes = new Set<() => void>()

/**
 * Send every delete that is still waiting out its undo window. Runs when the app is hidden or
 * closed: an iPhone suspends timers in the background, and a swiped-away app never runs them, so
 * without this the deleted item came back the next time the app opened.
 */
export function flushPendingDeletes() {
  for (const send of [...pendingDeletes]) send()
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingDeletes()
  })
  window.addEventListener('pagehide', flushPendingDeletes)
}

/**
 * Deferred delete with undo: runs `apply` immediately (optimistic), then `commit`
 * after the undo window unless the user pressed Undo, in which case `revert` runs.
 * Leaving the app during the window sends the delete at once (see flushPendingDeletes).
 */
export function deleteWithUndo(opts: { message: string; apply: () => void; commit: () => Promise<void> | void; revert: () => void }) {
  opts.apply()
  let settled = false
  const finish = () => {
    settled = true
    pendingDeletes.delete(send)
    window.clearTimeout(timer)
    useToasts.getState().dismiss(id)
  }
  const send = () => {
    if (settled) return
    finish()
    void opts.commit()
  }
  const id = toast.undoable(opts.message, () => {
    if (settled) return
    finish()
    opts.revert()
  })
  const timer = window.setTimeout(send, 6000)
  pendingDeletes.add(send)
}
