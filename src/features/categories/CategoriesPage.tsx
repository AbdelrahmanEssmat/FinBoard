import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Tags } from 'lucide-react'
import { Button, Card, Divider, Segmented } from '@/components/ui'
import { EmptyState, ListRow, PageHeader, PageSkeleton } from '@/components/shared'
import { useCategories } from '@/api/queries'
import { iconFor } from '@/utils/icons'
import { CategoryForm } from '@/features/categories/components/CategoryForm'
import type { Category, CategoryKind } from '@/api/database.types'

export default function CategoriesPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useCategories()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [form, setForm] = useState<{ open: boolean; item?: Category | null; parentId?: string | null }>({ open: false })
  const list = useMemo(() => (data ?? []).filter((c) => c.kind === kind), [data, kind])
  const parents = list.filter((c) => !c.parent_id)

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Categories"
        action={
          <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null, parentId: null })}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      <Segmented className="mb-6" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
      {isLoading && !data ? (
        <PageSkeleton />
      ) : !parents.length ? (
        <EmptyState icon={Tags} title="No categories" description="Create categories to organise your spending and income." action={<Button onClick={() => setForm({ open: true, item: null })}>Add category</Button>} />
      ) : (
        <Card className="overflow-hidden">
          {parents.map((p, i) => {
            const children = list.filter((c) => c.parent_id === p.id)
            return (
              <div key={p.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow icon={iconFor(p.icon)} color={p.color} title={<span className={p.is_archived ? 'text-faint line-through' : ''}>{p.name}</span>} subtitle={children.length ? `${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'}` : 'Tap for totals and trends'} onClick={() => navigate(`/categories/${p.id}`)} chevron />
                {children.map((c) => (
                  <ListRow key={c.id} className="pl-14" title={<span className={c.is_archived ? 'text-faint line-through' : 'text-muted'}>{c.name}</span>} onClick={() => navigate(`/categories/${c.id}`)} chevron />
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
