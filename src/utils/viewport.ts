/**
 * iPhone Safari can leave the page mis-sized after the on-screen keyboard closes, or after a
 * page that was pinned behind a sheet is released: bars fixed to the bottom then hang above a
 * blank strip until something makes Safari lay the page out again. This forces that: a real
 * scroll (a pixel down and back) and a change to the document's height that is undone at once.
 * Runs a few times to catch the end of the keyboard's closing animation.
 */
export function settleViewport() {
  if (typeof window === 'undefined') return
  const nudge = () => {
    const y = window.scrollY
    window.scrollTo(0, y + 1)
    window.scrollTo(0, y)
    const html = document.documentElement
    const was = html.style.height
    html.style.height = '100.5%'
    void html.offsetHeight // apply the change before undoing it, so the layout really runs twice
    html.style.height = was
    window.dispatchEvent(new Event('resize'))
  }
  window.requestAnimationFrame(nudge)
  window.setTimeout(nudge, 300)
  window.setTimeout(nudge, 650)
}
