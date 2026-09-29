import { COLORS } from '@/utils/icons'
import { cn } from '@/utils'

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="-m-1 flex flex-wrap gap-0.5">
      {COLORS.map((c) => (
        // a 44px tap target around a 36px swatch
        <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} className="flex h-11 w-11 items-center justify-center">
          <span className={cn('block h-9 w-9 rounded-full transition-transform', value === c ? 'scale-105 ring-2 ring-text ring-offset-2 ring-offset-surface' : 'hover:scale-105')} style={{ background: c }} />
        </button>
      ))}
    </div>
  )
}
