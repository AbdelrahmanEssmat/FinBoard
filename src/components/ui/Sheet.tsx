import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/utils'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { lockScroll } from '@/utils/scrollLock'

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 *
 * Phone behaviour:
 * - sized to the *visual* viewport, so when the keyboard opens the sheet shrinks
 *   and its header and footer stay reachable above the keyboard;
 * - the page behind is locked (no scroll bleed, no rubber-banding);
 * - a focused field is scrolled into view inside the sheet;
 * - drag the handle/header down to dismiss.
 * The body scrolls without a visible scrollbar; a soft fade hints at more content.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)
  const vv = useVisualViewport(open)
  const drag = useRef<{ startY: number; dy: number } | null>(null)
  const titleId = useId()
  useDialogFocus(panelRef, open)

  const measure = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])

  // Escape closes (unless a dialog on top already took it); lock the page behind the sheet (works on iOS unlike overflow:hidden alone)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    document.addEventListener('keydown', onKey)
    const unlock = lockScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      unlock()
    }
  }, [open, onClose])

  // fade indicator
  useEffect(() => {
    if (!open) return
    const el = bodyRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [open, measure, children, vv.height])

  // The keyboard finishes opening *after* focus, shrinking the visible area; re-center the
  // focused field each time the visible height changes so it never ends up hidden.
  useEffect(() => {
    if (!open) return
    const el = document.activeElement as HTMLElement | null
    if (!el || !bodyRef.current?.contains(el) || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
    const t = window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    return () => window.clearTimeout(t)
  }, [open, vv.height])

  // keep the focused control visible when it gains focus
  const onFocusIn = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
  }

  // swipe down on the handle / header to dismiss
  const onTouchStart = (e: TouchEvent) => {
    drag.current = { startY: e.touches[0]!.clientY, dy: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !panelRef.current) return
    const dy = Math.max(0, e.touches[0]!.clientY - drag.current.startY)
    drag.current.dy = dy
    panelRef.current.style.transform = `translateY(${dy}px)`
    panelRef.current.style.transition = 'none'
  }
  const onTouchEnd = () => {
    const panel = panelRef.current
    const dy = drag.current?.dy ?? 0
    drag.current = null
    if (!panel) return
    panel.style.transition = 'transform 200ms ease'
    if (dy > 90) {
      panel.style.transform = 'translateY(100%)'
      window.setTimeout(onClose, 180)
    } else {
      panel.style.transform = ''
    }
  }

  if (!open) return null
  const viewportStyle = vv.height ? { top: vv.offsetTop, height: vv.height } : undefined
  return createPortal(
    // top padding = the iPhone status bar / notch, so a tall sheet never slides under the clock and battery
    <div className="fixed inset-x-0 z-50 flex items-end justify-center pt-[env(safe-area-inset-top)] sm:items-center sm:p-6" style={viewportStyle} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'anim-sheet sm:anim-scale relative flex w-full flex-col overflow-hidden bg-surface shadow-2xl focus:outline-none',
          'max-h-[calc(100%-0.75rem)] rounded-t-3xl sm:max-h-[90%] sm:rounded-3xl',
          vv.keyboardOpen && 'max-h-full rounded-t-2xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="shrink-0 touch-none select-none sm:touch-auto" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border sm:hidden" />
          <div className="flex items-center justify-between px-6 pb-3 pt-3 sm:pt-6">
            <h2 id={titleId} className="min-w-0 truncate pr-3 text-lg font-semibold">
              {title}
            </h2>
            <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div ref={bodyRef} onScroll={measure} onFocus={onFocusIn} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="px-6 pb-6 pt-1">{children}</div>
          <div aria-hidden className={cn('pointer-events-none sticky bottom-0 -mt-10 h-10 bg-gradient-to-t from-surface to-transparent transition-opacity', moreBelow ? 'opacity-100' : 'opacity-0')} />
        </div>
        {footer ? (
          <div className={cn('shrink-0 border-t border-border bg-surface px-6 pt-3', vv.keyboardOpen ? 'pb-3' : 'pb-safe-4')}>{footer}</div>
        ) : (
          <div className={cn('shrink-0', vv.keyboardOpen ? 'h-2' : 'pb-safe')} />
        )}
      </div>
    </div>,
    document.body,
  )
}
