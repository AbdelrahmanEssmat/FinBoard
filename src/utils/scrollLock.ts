import { settleViewport } from '@/utils/viewport'

/**
 * Reference-counted page scroll lock. `overflow: hidden` alone does not stop iOS Safari
 * from scrolling the page behind an overlay, so the body is pinned with position: fixed
 * and restored to the same scroll offset when the last overlay closes.
 */
let locks = 0
let saved: { scrollY: number; style: Partial<CSSStyleDeclaration> } | null = null

export function lockScroll(): () => void {
  if (locks === 0) {
    const body = document.body
    const scrollY = window.scrollY
    saved = { scrollY, style: { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow } }
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' })
  }
  locks++
  let released = false
  return () => {
    if (released) return
    released = true
    locks = Math.max(0, locks - 1)
    if (locks === 0 && saved) {
      // a field still focused inside the closing overlay would keep the keyboard up while the page is released
      const active = document.activeElement as HTMLElement | null
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur()
      Object.assign(document.body.style, saved.style)
      window.scrollTo(0, saved.scrollY)
      saved = null
      settleViewport()
    }
  }
}
