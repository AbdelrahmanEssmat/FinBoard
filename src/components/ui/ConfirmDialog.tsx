import { createPortal } from 'react-dom'
import { cn } from '@/utils'
import { useVisualViewport } from '@/hooks/useVisualViewport'

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
  if (!open) return null
  return createPortal(
    <div className="fixed inset-x-0 z-[60] flex items-center justify-center p-6" style={vv.height ? { top: vv.offsetTop, height: vv.height } : undefined} role="alertdialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="anim-scale relative w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        {message ? <p className="mt-2 text-sm leading-relaxed text-muted">{message}</p> : null}
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="h-12 flex-1 rounded-2xl border border-border text-[15px] font-medium hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={cn('h-12 flex-1 rounded-2xl text-[15px] font-medium text-white', danger ? 'bg-negative' : 'bg-accent')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
