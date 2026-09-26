import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Bottom sheet on phones, centred dialog on larger screens.
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

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'anim-sheet sm:anim-scale relative flex max-h-[92dvh] w-full flex-col bg-surface shadow-2xl',
          'rounded-t-3xl sm:rounded-3xl sm:max-h-[85vh]',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2 sm:pt-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-border px-5 py-3 pb-safe sm:pb-3">{footer}</div> : <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="alertdialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="anim-scale relative w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="h-11 flex-1 rounded-2xl border border-border text-[15px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={cn('h-11 flex-1 rounded-2xl text-[15px] font-medium text-white', danger ? 'bg-negative' : 'bg-accent')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
