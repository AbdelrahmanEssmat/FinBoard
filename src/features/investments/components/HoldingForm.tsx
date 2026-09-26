import { useEffect, useState } from 'react'
import { HandCoins, Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { useAccounts, useHoldingSales, useInvestmentCategories } from '@/api/queries'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { cn } from '@/utils'
import { d } from '@/domain/money'
import { formatPercent, todayIso } from '@/domain/format'
import { openPosition } from '@/domain/investments'
import type { Holding } from '@/api/database.types'
import { DEFAULT_CURRENCY } from '@/domain/currency'

type EntryMode = 'unit' | 'total'

/**
 * A stock or fund. Prices can be typed per unit or as totals (what you paid in all / what it is
 * worth now); both are stored per unit.
 */
export function HoldingForm({ open, onClose, initial, onSell }: { open: boolean; onClose: () => void; initial?: Holding | null; onSell?: (h: Holding) => void }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useInvestmentCategories()
  const { data: sales } = useHoldingSales()
  const currencies = useActiveCurrencies()
  const platforms = (accounts ?? []).filter((a) => !a.is_archived && a.type === 'investment')
  const anyAccounts = (accounts ?? []).filter((a) => !a.is_archived)
  const upsert = useUpsert('holdings')
  const remove = useUndoableDelete('holdings', { label: 'Holding', invalidate: ['holding_sales'] })

  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [units, setUnits] = useState('')
  const [mode, setMode] = useState<EntryMode>('unit')
  const [avgCost, setAvgCost] = useState('')
  const [price, setPrice] = useState('')
  const [totalPaid, setTotalPaid] = useState('')
  const [totalNow, setTotalNow] = useState('')
  const [boughtAt, setBoughtAt] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setAccountId(initial?.account_id ?? platforms[0]?.id ?? anyAccounts[0]?.id ?? '')
    setCategoryId(initial?.category_id ?? categories?.[0]?.id ?? '')
    setName(initial?.name ?? '')
    setTicker(initial?.ticker ?? '')
    setUnits(initial ? String(initial.units) : '')
    setMode('unit')
    setAvgCost(initial ? String(initial.avg_cost) : '')
    setPrice(initial ? String(initial.current_price) : '')
    setTotalPaid('')
    setTotalNow('')
    setBoughtAt(initial ? (initial.bought_at ?? '') : todayIso())
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setNotes(initial?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const u = d(units)
  // per-unit prices that will be saved, whichever way they were typed
  const unitCost = mode === 'unit' ? d(avgCost) : u.gt(0) ? d(totalPaid).div(u) : d(0)
  const unitPrice = mode === 'unit' ? d(price) : u.gt(0) ? d(totalNow).div(u) : d(0)
  const pos = openPosition({ units: u, avg_cost: unitCost, current_price: unitPrice })
  const mySales = initial ? (sales ?? []).filter((s) => s.holding_id === initial.id) : []

  const valid = !!accountId && !!name.trim() && u.gte(0) && unitCost.gte(0) && unitPrice.gte(0) && (mode === 'unit' || u.gt(0))

  const switchMode = (m: EntryMode) => {
    if (m === mode) return
    // carry the numbers across so nothing typed is lost
    if (m === 'total' && u.gt(0)) {
      setTotalPaid(avgCost ? u.times(d(avgCost)).toDecimalPlaces(2).toString() : '')
      setTotalNow(price ? u.times(d(price)).toDecimalPlaces(2).toString() : '')
    }
    if (m === 'unit' && u.gt(0)) {
      if (totalPaid) setAvgCost(unitCost.toDecimalPlaces(6).toString())
      if (totalNow) setPrice(unitPrice.toDecimalPlaces(6).toString())
    }
    setMode(m)
  }

  const save = async () => {
    if (!valid) return
    const newPrice = unitPrice.toFixed(6)
    const priceChanged = !initial || d(initial.current_price).toFixed(6) !== newPrice
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        account_id: accountId,
        category_id: categoryId || null,
        name: name.trim(),
        ticker: ticker.trim().toUpperCase() || null,
        units: u.toFixed(6),
        avg_cost: unitCost.toFixed(6),
        current_price: newPrice,
        currency,
        bought_at: boughtAt || null,
        // adding units to a sold-out holding reopens it
        closed_at: u.gt(0) ? null : (initial?.closed_at ?? null),
        notes: notes.trim() || null,
        ...(priceChanged ? { price_updated_at: new Date().toISOString() } : {}),
      },
    ])
    onClose()
  }

  const canSell = !!initial && d(initial.units).gt(0) && !!onSell

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit holding' : 'New holding'}
      footer={
        <div className="flex gap-3">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          {canSell ? (
            <Button variant="secondary" size="lg" onClick={() => onSell!(initial!)}>
              <HandCoins className="h-4 w-4" /> Sell
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Azimut Gold Fund or COMI" />
          </Field>
          <Field label="Ticker">
            <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="COMI" className="w-24 uppercase" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label="Units">
            <Input inputMode="decimal" className="tnum" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Segmented<EntryMode>
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'unit', label: 'Per unit' },
            { value: 'total', label: 'Totals' },
          ]}
        />
        {mode === 'unit' ? (
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
            <Field label="Buy price">
              <Input inputMode="decimal" className="tnum" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Price now">
              <Input inputMode="decimal" className="tnum" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
            <Field label="Total paid">
              <Input inputMode="decimal" className="tnum" value={totalPaid} onChange={(e) => setTotalPaid(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Value now">
              <Input inputMode="decimal" className="tnum" value={totalNow} onChange={(e) => setTotalNow(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
        )}
        {mode === 'total' && !u.gt(0) ? <p className="-mt-3 text-xs text-muted">Enter the units first so the price per unit can be worked out.</p> : null}
        {pos.value.gt(0) || pos.cost.gt(0) ? (
          <div className="space-y-1.5 rounded-2xl bg-surface-2 p-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted">{mode === 'unit' ? 'Paid in total' : 'Buy price per unit'}</span>
              <span className="tnum">
                {(mode === 'unit' ? pos.cost : unitCost).toFixed(2)} {currency}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">{mode === 'unit' ? 'Worth now' : 'Price per unit now'}</span>
              <span className="tnum">
                {(mode === 'unit' ? pos.value : unitPrice).toFixed(2)} {currency}
              </span>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5">
              <span className="font-medium">{pos.pl.gte(0) ? 'Profit so far' : 'Loss so far'}</span>
              <span className={cn('tnum font-semibold', pos.pl.gte(0) ? 'text-positive' : 'text-negative')}>
                {pos.pl.gte(0) ? '+' : ''}
                {pos.pl.toFixed(2)} {pos.plPct ? `(${formatPercent(pos.plPct)})` : ''}
              </span>
            </div>
          </div>
        ) : null}
        <Field label="Bought on" hint="Used for how long you held it when you sell">
          <Input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this holding?"
        message={
          mySales.length
            ? `Its ${mySales.length} sale${mySales.length === 1 ? '' : 's'} will be removed from your investment history. Money already received stays in your accounts.`
            : undefined
        }
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
