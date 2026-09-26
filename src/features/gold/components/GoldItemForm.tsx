import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
import { KARATS } from '@/domain/gold'
import type { GoldItem, GoldType } from '@/api/database.types'

export function GoldItemForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: GoldItem | null }) {
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('gold_items')
  const remove = useUndoableDelete('gold_items', { label: 'Gold item' })
  const [name, setName] = useState('')
  const [karat, setKarat] = useState<number>(21)
  const [type, setType] = useState<GoldType>('bar')
  const [weight, setWeight] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EGP')
  const [workmanship, setWorkmanship] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setKarat(initial?.karat ?? 21)
    setType(initial?.type ?? 'bar')
    setWeight(initial ? String(initial.weight_grams) : '')
    setPrice(initial ? String(initial.purchase_price) : '')
    setCurrency(initial?.purchase_currency ?? 'EGP')
    setWorkmanship(initial && initial.workmanship_cost ? String(initial.workmanship_cost) : '')
    setDate(initial?.purchase_date ?? '')
    setNotes(initial?.notes ?? '')
  }, [open, initial])

  const valid = d(weight).gt(0)
  const save = async () => {
    if (!valid) return
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        name: name.trim() || null,
        karat,
        type,
        weight_grams: d(weight).toFixed(4),
        purchase_price: toDb(price || 0),
        purchase_currency: currency,
        workmanship_cost: type === 'jewelry' ? toDb(workmanship || 0) : '0',
        purchase_date: date || null,
        notes: notes.trim() || null,
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit gold' : 'Add gold'}
      footer={
        <div className="flex gap-3">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Segmented value={type} onChange={setType} options={[{ value: 'bar', label: 'Bar' }, { value: 'coin', label: 'Coin' }, { value: 'jewelry', label: 'Jewelry' }]} />
        <Field label="Karat">
          <Segmented value={String(karat)} onChange={(v) => setKarat(Number(v))} options={KARATS.map((k) => ({ value: String(k), label: `${k}K` }))} />
        </Field>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label="Weight (grams)">
            <Input inputMode="decimal" className="tnum" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Purchase price (total)">
            <Input inputMode="decimal" className="tnum" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24">
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {type === 'jewelry' ? (
          <Field label="Workmanship (masna'ya)" hint="Counted in cost, not in current value">
            <Input inputMode="decimal" className="tnum" value={workmanship} onChange={(e) => setWorkmanship(e.target.value)} placeholder="0.00" />
          </Field>
        ) : null}
        <Field label="Purchase date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this gold item?"
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
