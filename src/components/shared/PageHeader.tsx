import type { ReactNode } from 'react'
import { BackButton } from '@/components/shared/BackButton'

/**
 * Standard screen header. The back arrow sits on its own line above the title so every
 * page title starts at the same left edge (iOS large-title pattern). Pass a node to
 * `back` to replace the arrow.
 */
export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: boolean | ReactNode }) {
  return (
    <div className="mb-7">
      {back ? <div className="-mt-1 mb-1">{back === true ? <BackButton /> : back}</div> : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-bold leading-[34px] tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-[15px] leading-5 text-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
      </div>
    </div>
  )
}
