import { COLORS, ICONS, ICON_NAMES } from '@/lib/icons'
import { cn } from '@/lib/utils'

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('h-8 w-8 rounded-full transition-transform', value === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-text scale-105' : 'hover:scale-105')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

export function IconPicker({ value, onChange, color }: { value: string; onChange: (i: string) => void; color?: string }) {
  return (
    <div className="grid max-h-40 grid-cols-8 gap-1.5 overflow-y-auto rounded-xl border border-border p-2">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name]!
        const active = name === value
        return (
          <button
            key={name}
            type="button"
            aria-label={name}
            onClick={() => onChange(name)}
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg transition-colors', active ? 'text-white' : 'text-muted hover:bg-surface-2')}
            style={active ? { background: color ?? 'var(--color-accent)' } : undefined}
          >
            <Icon className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}
