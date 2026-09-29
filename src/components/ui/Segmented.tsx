import type { ReactNode } from 'react'
import { cn } from '@/utils'

/**
 * Pill-shaped segmented control. The track and the moving thumb are both fully rounded
 * so the thumb's curve always follows the track's (concentric shapes), at any size.
 */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex rounded-full bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            // min-w-0 + truncate let many options share a narrow phone screen instead of overflowing it
            'min-h-10 min-w-0 flex-1 truncate rounded-full px-1.5 py-2 text-sm font-medium transition-all min-[360px]:px-2 sm:px-3',
            o.value === value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
