import { useEffect, useRef, useState } from 'react'
import { Button, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useSubAccounts } from '@/api/queries'
import { useSellHolding } from '@/api/mutations'
import { newId } from '@/utils/ids'
import { cn } from '@/utils'
import { d, parseAmount } from '@/domain/money'
import { formatPercent, todayIso } from '@/domain/format'
import { previewSale } from '@/domain/investments'
import { daysBetween } from '@/utils/dates'
import { toast } from '@/store/toasts'
import { usePrefs } from '@/store/prefs'
import type { Holding } from '@/api/database.types'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'

type PriceMode = 'unit' | 'total'

/** Sell some or all units of a holding; books the realized profit or loss. */
export function SellHoldingSheet({ open, onClose, holding, onSold }: { open: boolean; onClose: () => void; holding: Holding | null; onSold?: () => void }) {
  const { data: subs } = useSubAccounts()
  const privacy = usePrefs((s) => s.privacy)
  const sell = useSellHolding()
  // fixed per opening: a retried Sell books the same sale once, never twice
  const ids = useRef({ sale: '', tx: '' })

  const [units, setUnits] = useState('')
  const [mode, setMode] = useState<PriceMode>('unit')
  const [price, setPrice] = useState('')
  const [total, setTotal] = useState('')
  const [fees, setFees] = useState('')
  const [date, setDate] = useState(todayIso())
  const [subId, setSubId] = useState('')
  const [notes, setNotes] = useState('')

  // proceeds can only land in a balance of the holding's currency
  const subsForCurrency = (subs ?? []).filter((s) => !s.is_archived && s.currency === holding?.currency)

  useEffect(() => {
    if (!open || !holding) return
    ids.current = { sale: newId(), tx: newId() }
    setUnits(String(holding.units))
    setMode('unit')
    setPrice(String(holding.current_price))
    setTotal('')
    setFees('')
    setDate(todayIso())
    setNotes('')
    // default: the platform's own cash balance in that currency
    const onPlatform = subsForCurrency.filter((s) => s.account_id === holding.account_id)
    setSubId((onPlatform.find((s) => s.yield_rate === null) ?? onPlatform[0])?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, holding?.id])

  if (!holding) return null
  const held = d(holding.units)
  const u = d(units)
  // price per unit actually sent: typed directly, or derived from the total sale value
  const unitPrice = mode === 'unit' ? d(price) : u.gt(0) ? d(total).div(u) : d(0)
  const priceArg = unitPrice.toDecimalPlaces(10).toString()
  const p = previewSale(holding.avg_cost, u, priceArg, fees || 0)
  const days = holding.bought_at ? Math.max(0, daysBetween(holding.bought_at, date)) : null
  const tooMany = u.gt(held)
  const effectiveSubId = subsForCurrency.some((s) => s.id === subId) ? subId : ''
  // every field must hold a real number: "12..5" used to be read as 0 and booked the sale at price 0
  const numberOk = (v: string, required: boolean) => (v.trim() === '' ? !required : parseAmount(v) !== null)
  const typedOk = numberOk(units, true) && (mode === 'unit' ? numberOk(price, true) : numberOk(total, true)) && numberOk(fees, false)
  const valid = typedOk && u.gt(0) && !tooMany && unitPrice.gte(0) && d(fees || 0).gte(0) && p.proceeds.gte(0) && !!date

  const save = async () => {
    if (!valid) return
    await sell.mutateAsync({
      holding,
      units: u.toString(),
      price: priceArg,
      fees: d(fees || 0).toString(),
      date,
      subAccountId: effectiveSubId || null,
      notes: notes.trim() || null,
      saleId: ids.current.sale,
      transactionId: ids.current.tx,
    })
    toast.success(privacy ? 'Sale booked' : `${p.realized.gte(0) ? 'Profit' : 'Loss'} of ${p.realized.abs().toFixed(2)} ${holding.currency} booked`)
    onSold?.()
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Sell ${holding.name}`}
      footer={
        <Button full size="lg" onClick={save} loading={sell.isPending} disabled={!valid}>
          Sell {u.gt(0) && u.eq(held) ? 'all' : ''}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-muted text-sm">
          You hold <span className="tnum text-text font-medium">{held.toString()}</span> units bought at <Amount value={holding.avg_cost} currency={holding.currency} className="font-medium text-text" />.
        </p>
        <Field label="Units to sell">
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              className={cn('tnum flex-1', tooMany && 'border-negative')}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="0"
            />
            <Button variant="soft" size="lg" className="shrink-0" onClick={() => setUnits(held.toString())}>
              All
            </Button>
          </div>
        </Field>
        {tooMany ? <p className="text-negative -mt-3 text-xs">You only hold {held.toString()} units.</p> : null}
        <Segmented<PriceMode>
          value={mode}
          onChange={(m) => {
            // carry the number across so switching doesn't lose it
            if (m === 'total' && unitPrice.gt(0) && u.gt(0)) setTotal(u.times(unitPrice).toDecimalPlaces(2).toString())
            if (m === 'unit' && unitPrice.gt(0)) setPrice(unitPrice.toDecimalPlaces(6).toString())
            setMode(m)
          }}
          options={[
            { value: 'unit', label: 'Price per unit' },
            { value: 'total', label: 'Total sale value' },
          ]}
        />
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          {mode === 'unit' ? (
            <Field label={`Sell price (${holding.currency})`}>
              <Input inputMode="decimal" className="tnum" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </Field>
          ) : (
            <Field label={`Sale value (${holding.currency})`}>
              <Input inputMode="decimal" className="tnum" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
            </Field>
          )}
          <Field label="Fees">
            <Input inputMode="decimal" className="tnum" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Date sold">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Money received into" hint="Leave empty if you are only recording the sale">
          <Select value={effectiveSubId} onChange={(e) => setSubId(e.target.value)}>
            <option value="">No account</option>
            <BalanceOptions subs={subsForCurrency} />
          </Select>
        </Field>

        {u.gt(0) && !tooMany ? (
          <div className="bg-surface-2 space-y-2 rounded-2xl p-4 text-sm">
            <PreviewRow label="You receive" value={<Amount value={p.proceeds} currency={holding.currency} />} />
            <PreviewRow label="You paid" value={<Amount value={p.costBasis} currency={holding.currency} />} />
            <div className="border-border flex items-center justify-between border-t pt-2">
              <span className="font-medium">{p.realized.gte(0) ? 'Profit' : 'Loss'}</span>
              <span className={cn('tnum font-semibold', p.realized.gte(0) ? 'text-positive' : 'text-negative')}>
                <Amount value={p.realized} currency={holding.currency} showSign /> {p.realizedPct ? `(${formatPercent(p.realizedPct)})` : ''}
              </span>
            </div>
            {days !== null ? <PreviewRow label="Held for" value={`${days} day${days === 1 ? '' : 's'}`} /> : null}
          </div>
        ) : null}

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="tnum text-right">{value}</span>
    </div>
  )
}
