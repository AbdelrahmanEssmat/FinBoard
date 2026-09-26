import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToasts } from '@/store/toasts'
import { cn } from '@/utils'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info
        return (
          <div
            key={t.id}
            className={cn(
              'anim-fade-up pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-xl',
              'bg-text text-bg dark:bg-surface-2 dark:text-text dark:border dark:border-border',
            )}
            role="status"
          >
            <Icon className={cn('h-4 w-4 shrink-0', t.kind === 'error' ? 'text-negative' : t.kind === 'success' ? 'text-positive' : 'opacity-70')} />
            <span className="flex-1">{t.message}</span>
            {t.undo ? (
              <button
                onClick={() => {
                  t.undo?.()
                  dismiss(t.id)
                }}
                className="font-semibold text-accent"
              >
                Undo
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
