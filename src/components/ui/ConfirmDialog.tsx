import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { useDialogFocus } from '@/hooks/useDialogFocus'

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
  const vv = useVisualViewport(open)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()
  // focus lands on Cancel: the safe choice for a destructive question
  useDialogFocus(panelRef, open, { initialFocus: cancelRef })

  // Escape closes this dialog only, not the sheet it may sit on (captured before the sheet's listener)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="h-app fixed inset-x-0 top-0 z-[60] flex items-center justify-center p-6"
      style={vv.keyboardOpen && vv.height ? { top: vv.offsetTop, height: vv.height } : undefined}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
    >
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="anim-scale relative w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl focus:outline-none">
        <h3 id={titleId} className="text-lg font-semibold">
          {title}
        </h3>
        {message ? (
          <p id={messageId} className="mt-2 text-sm leading-relaxed text-muted">
            {message}
          </p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button ref={cancelRef} onClick={onClose} className="h-12 flex-1 rounded-2xl border border-border text-[15px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={cn('h-12 flex-1 rounded-2xl text-[15px] font-medium text-white', danger ? 'bg-negative-strong' : 'bg-accent-strong')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
