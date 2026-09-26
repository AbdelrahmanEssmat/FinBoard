import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ICONS, ICON_NAMES } from '@/utils/icons'
import { cn } from '@/utils'

const PREVIEW_COUNT = 16

/** Icon grid. Shows a first row set by default and expands in place; never scrolls inside the form. */
export function IconPicker({ value, onChange, color }: { value: string; onChange: (i: string) => void; color?: string }) {
  const [expanded, setExpanded] = useState(false)
  const selectedIndex = ICON_NAMES.indexOf(value)
  const names = expanded ? ICON_NAMES : ICON_NAMES.slice(0, PREVIEW_COUNT)
  // keep the chosen icon visible even when it sits beyond the preview
  if (!expanded && selectedIndex >= PREVIEW_COUNT) names[names.length - 1] = value

  return (
    <div className="rounded-xl border border-border p-2.5">
      <div className="grid grid-cols-8 gap-2">
        {names.map((name) => {
          const Icon = ICONS[name]!
          const active = name === value
          return (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={active}
              onClick={() => onChange(name)}
              className={cn('flex h-10 w-full items-center justify-center rounded-lg transition-colors', active ? 'text-white' : 'text-muted hover:bg-surface-2')}
              style={active ? { background: color ?? 'var(--color-accent)' } : undefined}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-accent hover:bg-surface-2">
        {expanded ? (
          <>
            Show fewer <ChevronUp className="h-3.5 w-3.5" />
          </>
        ) : (
          <>
            More icons <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>
    </div>
  )
}
