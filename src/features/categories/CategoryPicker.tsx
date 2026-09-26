import { useMemo } from 'react'
import { useCategories } from '@/lib/data/tables'
import { iconFor } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { CategoryKind } from '@/lib/database.types'

/** Horizontal chip picker: parent categories, with sub-categories shown once a parent is chosen. */
export function CategoryPicker({ kind, value, onChange }: { kind: CategoryKind; value: string | null; onChange: (id: string | null) => void }) {
  const { data } = useCategories()
  const cats = useMemo(() => (data ?? []).filter((c) => c.kind === kind && !c.is_archived), [data, kind])
  const parents = cats.filter((c) => !c.parent_id)
  const selected = cats.find((c) => c.id === value)
  const activeParentId = selected?.parent_id ?? selected?.id ?? null
  const children = activeParentId ? cats.filter((c) => c.parent_id === activeParentId) : []

  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {parents.map((c) => {
          const Icon = iconFor(c.icon)
          const active = c.id === activeParentId
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors', active ? 'border-transparent text-white' : 'border-border bg-surface text-muted hover:text-text')}
              style={active ? { background: c.color } : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {c.name}
            </button>
          )
        })}
        {!parents.length ? <span className="text-sm text-faint">No {kind} categories yet</span> : null}
      </div>
      {children.length ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => onChange(activeParentId)} className={cn('shrink-0 rounded-full px-3 py-1 text-xs', value === activeParentId ? 'bg-text text-bg' : 'bg-surface-2 text-muted')}>
            General
          </button>
          {children.map((c) => (
            <button key={c.id} type="button" onClick={() => onChange(c.id)} className={cn('shrink-0 rounded-full px-3 py-1 text-xs', value === c.id ? 'bg-text text-bg' : 'bg-surface-2 text-muted')}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
