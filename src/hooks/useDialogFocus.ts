import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Rendered and not hidden (checkVisibility sees display:none ancestors; the fallback is for older engines and tests). */
const visible = (el: HTMLElement) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : !el.hidden)

/**
 * Keyboard focus for a sheet or dialog: when it opens, focus moves into it (the panel itself,
 * so no keyboard pops up on a phone, or `initialFocus`); Tab cycles inside it; when it closes,
 * focus goes back to whatever opened it. A dialog opened from inside a sheet that closes along
 * with it simply hands focus back to the page.
 */
export function useDialogFocus(panelRef: RefObject<HTMLElement | null>, open: boolean, opts: { initialFocus?: RefObject<HTMLElement | null> } = {}) {
  const initialFocus = opts.initialFocus
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const opener = document.activeElement as HTMLElement | null
    ;(initialFocus?.current ?? panel).focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    panel.addEventListener('keydown', onKey)
    return () => {
      panel.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, panelRef, initialFocus])
}
