import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui'
import { cn } from '@/utils'

/** Small KPI tile: label on top, value beneath, optional icon and footnote. */
export function StatCard({ label, value, icon: Icon, iconClass, foot, className }: { label: ReactNode; value: ReactNode; icon?: LucideIcon; iconClass?: string; foot?: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {Icon ? <Icon className={cn('h-3.5 w-3.5', iconClass)} /> : null}
        {label}
      </div>
      <div className="mt-1.5 text-[17px] font-semibold leading-tight sm:text-lg">{value}</div>
      {foot ? <div className="mt-1 text-[11px] text-faint">{foot}</div> : null}
    </Card>
  )
}
