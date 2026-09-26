import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, Select, Sheet, Textarea } from '@/components/ui'
import { useAccounts, useInvestmentCategories } from '@/lib/data/tables'
import { useUndoableDelete, useUpsert } from '@/lib/data/mutations'
import { useActiveCurrencies } from '@/lib/data/derived'
import { newId } from '@/lib/ids'
import { d } from '@/domain/money'
import type { Holding } from '@/lib/database.types'

export function HoldingForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Holding | null }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useInvestmentCategories()
  const currencies = useActiveCurrencies()
  const platforms = (accounts ?? []).filter((a) => !a.is_archived && a.type === 'investment')
  const anyAccounts = (accounts ?? []).filter((a) => !a.is_archived)
  const upsert = useUpsert('holdings')
  const remove = useUndoableDelete('holdings', { label: 'Holding' })

  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [units, setUnits] = useState('')
  const [avgCost, setAvgCost] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EGP')
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setAccountId(initial?.account_id ?? platforms[0]?.id ?? anyAccounts[0]?.id ?? '')
    setCategoryId(initial?.category_id ?? categories?.[0]?.id ?? '')
    setName(initial?.name ?? '')
    setTicker(initial?.ticker ?? '')
    setUnits(initial ? String(initial.units) : '')
    setAvgCost(initial ? String(initial.avg_cost) : '')
    setPrice(initial ? String(initial.current_price) : '')
    setCurrency(initial?.currency ?? 'EGP')
    setNotes(initial?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const valid = accountId && name.trim() && d(units).gte(0)
  const value = d(units).times(d(price))
  const cost = d(units).times(d(avgCost))

  const save = async () => {
    if (!valid) return
    const priceChanged = !initial || d(initial.current_price).toString() !== d(price).toString()
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        account_id: accountId,
        category_id: categoryId || null,
        name: name.trim(),
        ticker: ticker.trim().toUpperCase() || null,
        units: d(units).toFixed(6),
        avg_cost: d(avgCost).toFixed(6),
        current_price: d(price).toFixed(6),
        currency,
        notes: notes.trim() || null,
        ...(priceChanged ? { price_updated_at: new Date().toISOString() } : {}),
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit holding' : 'New holding'}
      footer={
        <div className="flex gap-2">
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
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {(platforms.length ? platforms : anyAccounts).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Commercial International Bank" />
          </Field>
          <Field label="Ticker">
            <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="COMI" className="w-24 uppercase" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Units">
            <Input inputMode="decimal" className="tnum" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Avg cost">
            <Input inputMode="decimal" className="tnum" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Price now">
            <Input inputMode="decimal" className="tnum" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        {value.gt(0) ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
            Value <span className="tnum font-medium text-text">{value.toFixed(2)} {currency}</span> · cost {cost.toFixed(2)} · P/L{' '}
            <span className={`tnum font-medium ${value.gte(cost) ? 'text-positive' : 'text-negative'}`}>{value.minus(cost).toFixed(2)}</span>
          </p>
        ) : null}
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this holding?"
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
