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

/**
 * Deferred delete with undo: runs `apply` immediately (optimistic), then `commit`
 * after the undo window unless the user pressed Undo, in which case `revert` runs.
 */
export function deleteWithUndo(opts: { message: string; apply: () => void; commit: () => Promise<void> | void; revert: () => void }) {
  opts.apply()
  let cancelled = false
  const id = toast.undoable(opts.message, () => {
    cancelled = true
    useToasts.getState().dismiss(id)
    opts.revert()
  })
  window.setTimeout(() => {
    if (!cancelled) void opts.commit()
  }, 6000)
}
