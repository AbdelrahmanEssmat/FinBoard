import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui'
import { cn } from '@/utils'

/** Small KPI tile: label on top, value beneath, optional icon and footnote. */
export function StatCard({ label, value, icon: Icon, iconClass, foot, className }: { label: ReactNode; value: ReactNode; icon?: LucideIcon; iconClass?: string; foot?: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex min-w-0 flex-col p-3 min-[360px]:p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {Icon ? <Icon className={cn('h-3.5 w-3.5 shrink-0', iconClass)} /> : null}
        <span className="truncate">{label}</span>
      </div>
      {/* an <Amount fit> inside shrinks its text to the tile; plain text may wrap */}
      <div className="mt-2 min-w-0 text-lg font-semibold leading-6 tracking-tight">{value}</div>
      {foot ? <div className="mt-1 truncate text-[11px] leading-4 text-faint">{foot}</div> : null}
    </Card>
  )
}
