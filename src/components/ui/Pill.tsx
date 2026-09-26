import type { ReactNode } from 'react'
import { cn } from '@/utils'

const tones = {
  neutral: 'bg-surface-2 text-muted',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent',
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>
}
