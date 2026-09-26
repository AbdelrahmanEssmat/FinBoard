import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, Sheet, Textarea } from '@/components/ui'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { newId } from '@/utils/ids'
import type { Contact } from '@/api/database.types'

export function ContactForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Contact | null }) {
  const upsert = useUpsert('contacts')
  const remove = useUndoableDelete('contacts', { invalidate: ['debts', 'debt_payments'], label: 'Person' })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setPhone(initial?.phone ?? '')
    setNotes(initial?.notes ?? '')
  }, [open, initial])

  const save = async () => {
    if (!name.trim()) return
    await upsert.mutateAsync([{ id: initial?.id ?? newId(), name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null }])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit person' : 'New person'}
      footer={
        <div className="flex gap-3">
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
        <Field label="Phone">
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this person?"
        message="All debts with this person will be deleted too."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
