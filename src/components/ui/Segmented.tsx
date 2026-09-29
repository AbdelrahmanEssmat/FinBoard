import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/utils'

/**
 * Pill-shaped segmented control: one choice out of a few (a radio group). The track and the
 * moving thumb are both fully rounded so the thumb's curve always follows the track's
 * (concentric shapes), at any size. Arrow keys move between the options.
 */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + options.length) % options.length
    onChange(options[next]!.value)
    refs.current[next]?.focus()
  }
  return (
    <div className={cn('flex rounded-full bg-surface-2 p-1', className)} role="radiogroup">
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
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
