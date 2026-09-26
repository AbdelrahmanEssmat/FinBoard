import { ICONS, ICON_NAMES } from '@/utils/icons'
import { cn } from '@/utils'

export function IconPicker({ value, onChange, color }: { value: string; onChange: (i: string) => void; color?: string }) {
  return (
    <div className="grid max-h-44 grid-cols-7 gap-2 overflow-y-auto rounded-xl border border-border p-2.5 sm:grid-cols-8">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name]!
        const active = name === value
        return (
          <button
            key={name}
            type="button"
            aria-label={name}
            aria-pressed={active}
            onClick={() => onChange(name)}
            className={cn('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', active ? 'text-white' : 'text-muted hover:bg-surface-2')}
            style={active ? { background: color ?? 'var(--color-accent)' } : undefined}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        )
      })}
    </div>
  )
}
