import type { ReactNode } from 'react'
import { BackButton } from '@/components/shared/BackButton'

/**
 * Standard screen header. `back` shows a back arrow; pass a node to override it.
 */
export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: boolean | ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2">
        {back === true ? <BackButton /> : back || null}
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
    </div>
  )
}
