/**
 * Reference-counted page scroll lock for overlays. On phones the page scrolls inside the app
 * frame and the document itself never moves, so there is nothing to lock; on desktop the document
 * scrolls, and `overflow: hidden` on the body keeps it still behind the overlay.
 */
let locks = 0
let savedOverflow: string | null = null

const documentScrolls = () => document.documentElement.scrollHeight > window.innerHeight + 1

export function lockScroll(): () => void {
  if (locks === 0 && documentScrolls()) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  locks++
  let released = false
  return () => {
    if (released) return
    released = true
    locks = Math.max(0, locks - 1)
    if (locks === 0) {
      if (savedOverflow !== null) {
        document.body.style.overflow = savedOverflow
        savedOverflow = null
      }
    }
  }
}
