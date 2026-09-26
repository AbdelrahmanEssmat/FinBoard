import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ColorPicker, ConfirmDialog, Field, IconPicker, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useCategories } from '@/api/queries'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { newId } from '@/utils/ids'
import type { Category, CategoryKind } from '@/api/database.types'

export function CategoryForm({ open, onClose, initial, kind, parentId }: { open: boolean; onClose: () => void; initial?: Category | null; kind: CategoryKind; parentId?: string | null }) {
  const { data } = useCategories()
  const upsert = useUpsert('categories')
  const remove = useUndoableDelete('categories', { invalidate: ['transactions', 'budgets'], label: 'Category' })
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('tag')
  const [color, setColor] = useState('#64748b')
  const [parent, setParent] = useState<string>('')
  const [archived, setArchived] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const parents = (data ?? []).filter((c) => c.kind === kind && !c.parent_id && c.id !== initial?.id)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setIcon(initial?.icon ?? 'tag')
    setColor(initial?.color ?? '#64748b')
    setParent(initial?.parent_id ?? parentId ?? '')
    setArchived(initial?.is_archived ?? false)
  }, [open, initial, parentId])

  const save = async () => {
    if (!name.trim()) return
    const parentCat = parents.find((p) => p.id === parent)
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        kind,
        name: name.trim(),
        icon: parent ? parentCat?.icon ?? icon : icon,
        color: parent ? parentCat?.color ?? color : color,
        parent_id: parent || null,
        is_archived: archived,
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit category' : parent ? 'New sub-category' : 'New category'}
      footer={
        <div className="flex gap-2">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Parent">
          <Select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">None (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {!parent ? (
          <>
            <Field label="Colour">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
            <Field label="Icon">
              <IconPicker value={icon} onChange={setIcon} color={color} />
            </Field>
          </>
        ) : null}
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hidden from pickers, kept on old transactions" /> : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this category?"
        message="Transactions keep their data but lose this category. Consider archiving instead."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
