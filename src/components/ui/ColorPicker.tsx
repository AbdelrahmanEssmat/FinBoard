import { COLORS } from '@/utils/icons'
import { cn } from '@/utils'

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn('h-9 w-9 rounded-full transition-transform', value === c ? 'scale-105 ring-2 ring-text ring-offset-2 ring-offset-surface' : 'hover:scale-105')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
