import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Tags } from 'lucide-react'
import { Button, Card, Divider, EmptyState, ListRow, PageHeader, Segmented } from '@/components/ui'
import { useCategories } from '@/lib/data/tables'
import { iconFor } from '@/lib/icons'
import { CategoryForm } from './CategoryForm'
import type { Category, CategoryKind } from '@/lib/database.types'

export default function CategoriesPage() {
  const navigate = useNavigate()
  const { data } = useCategories()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [form, setForm] = useState<{ open: boolean; item?: Category | null; parentId?: string | null }>({ open: false })
  const list = useMemo(() => (data ?? []).filter((c) => c.kind === kind), [data, kind])
  const parents = list.filter((c) => !c.parent_id)

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Categories"
        action={
          <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null, parentId: null })}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      <Segmented className="mb-4" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
      {!parents.length ? (
        <EmptyState icon={Tags} title="No categories" description="Create categories to organise your spending and income." action={<Button onClick={() => setForm({ open: true, item: null })}>Add category</Button>} />
      ) : (
        <Card className="overflow-hidden">
          {parents.map((p, i) => {
            const children = list.filter((c) => c.parent_id === p.id)
            return (
              <div key={p.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow icon={iconFor(p.icon)} color={p.color} title={<span className={p.is_archived ? 'text-faint line-through' : ''}>{p.name}</span>} subtitle={children.length ? `${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'}` : undefined} onClick={() => setForm({ open: true, item: p })} chevron />
                {children.map((c) => (
                  <ListRow key={c.id} className="pl-14" title={<span className={c.is_archived ? 'text-faint line-through' : 'text-muted'}>{c.name}</span>} onClick={() => setForm({ open: true, item: c })} chevron />
                ))}
                <button onClick={() => setForm({ open: true, item: null, parentId: p.id })} className="flex w-full items-center gap-2 py-2 pl-14 text-xs font-medium text-accent hover:bg-surface-2">
                  <Plus className="h-3 w-3" /> Sub-category
                </button>
              </div>
            )
          })}
        </Card>
      )}
      <CategoryForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} kind={kind} parentId={form.parentId ?? null} />
    </div>
  )
}
