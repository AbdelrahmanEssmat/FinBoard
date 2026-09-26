import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/utils'

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 * The body scrolls without a visible scrollbar; a soft fade at the bottom hints that more content follows.
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
  const [moreBelow, setMoreBelow] = useState(false)

  const measure = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const el = bodyRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [open, measure, children])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'anim-sheet sm:anim-scale relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl',
          'rounded-t-3xl sm:max-h-[90vh] sm:rounded-3xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden" />
        <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-4 sm:pt-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={bodyRef} onScroll={measure} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-6 pb-6 pt-1">{children}</div>
          <div
            aria-hidden
            className={cn('pointer-events-none sticky bottom-0 -mt-10 h-10 bg-gradient-to-t from-surface to-transparent transition-opacity', moreBelow ? 'opacity-100' : 'opacity-0')}
          />
        </div>
        {footer ? <div className="pb-safe-4 shrink-0 border-t border-border bg-surface px-6 pt-4">{footer}</div> : <div className="pb-safe shrink-0" />}
      </div>
    </div>,
    document.body,
  )
}
