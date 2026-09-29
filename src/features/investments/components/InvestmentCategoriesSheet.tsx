import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button, Input, Sheet } from '@/components/ui'
import { useInvestmentCategories } from '@/api/queries'
import { useUndoableDelete, useUpdateRows, useUpsert } from '@/api/mutations'
import { newId } from '@/utils/ids'

export function InvestmentCategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useInvestmentCategories()
  const upsert = useUpsert('investment_categories', { silent: true })
  const rename = useUpdateRows('investment_categories', { silent: true })
  const remove = useUndoableDelete('investment_categories', { invalidate: ['holdings'], label: 'Category' })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState('')

  return (
    <Sheet open={open} onClose={onClose} title="Investment types">
      <div className="space-y-2 pb-2">
        {(data ?? []).map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            {editing === c.id ? (
              <>
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9" />
                <button aria-label="Save" disabled={rename.isPending} onClick={async () => { await rename.mutateAsync([{ id: c.id, name: draft.trim() || c.name }]); setEditing(null) }} className="flex h-11 w-11 items-center justify-center text-positive disabled:opacity-50">
                  <Check className="h-4 w-4" />
                </button>
                <button aria-label="Cancel" onClick={() => setEditing(null)} className="flex h-11 w-11 items-center justify-center text-muted">
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-[15px]">{c.name}</span>
                <button aria-label={`Rename ${c.name}`} onClick={() => { setEditing(c.id); setDraft(c.name) }} className="flex h-11 w-11 items-center justify-center text-muted">
                  <Pencil className="h-4 w-4" />
                </button>
                <button aria-label={`Delete ${c.name}`} onClick={() => remove(c)} className="flex h-11 w-11 items-center justify-center text-negative">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New type, e.g. Bonds" aria-label="New type" />
          <Button
            variant="soft"
            aria-label="Add type"
            loading={upsert.isPending}
            disabled={!adding.trim()}
            onClick={async () => {
              if (!adding.trim()) return
              await upsert.mutateAsync([{ id: newId(), name: adding.trim(), sort_order: (data?.length ?? 0) + 1 }])
              setAdding('')
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
