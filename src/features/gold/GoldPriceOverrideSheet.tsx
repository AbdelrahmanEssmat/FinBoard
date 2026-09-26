import { useEffect, useState } from 'react'
import { Button, Field, Input, Sheet } from '@/components/ui'
import { useGoldPriceTable } from '@/lib/data/derived'
import { useUpsert, useDeleteRows } from '@/lib/data/mutations'
import { useUserId } from '@/lib/auth'
import { newId } from '@/lib/ids'
import { d } from '@/domain/money'
import { KARATS, type Karat } from '@/domain/gold'

/** Manually set today's EGP price per gram. A blank field keeps the automatic price. */
export function GoldPriceOverrideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prices = useGoldPriceTable()
  const upsert = useUpsert('gold_prices')
  const remove = useDeleteRows('gold_prices')
  const userId = useUserId()
  const [values, setValues] = useState<Record<Karat, string>>({ 24: '', 22: '', 21: '', 18: '' })

  useEffect(() => {
    if (!open) return
    setValues({ 24: '', 22: '', 21: '', 18: '' })
  }, [open])

  const manualRows = KARATS.map((k) => prices.rows[k]).filter((r) => r && r.user_id)

  const save = async () => {
    const now = new Date().toISOString()
    const rows = KARATS.filter((k) => d(values[k]).gt(0)).map((k) => ({
      id: newId(),
      user_id: userId ?? undefined,
      karat: k,
      price_per_gram: d(values[k]).toFixed(4),
      currency: 'EGP',
      source: 'manual' as const,
      source_name: 'Manual',
      price_at: now,
    }))
    if (rows.length) await upsert.mutateAsync(rows)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Override gold price"
      footer={
        <Button full size="lg" onClick={save} loading={upsert.isPending}>
          Save override
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm text-muted">Enter the price per gram in EGP. Your value is used until the next automatic update comes in with a newer time.</p>
        <div className="grid grid-cols-2 gap-3">
          {KARATS.map((k) => (
            <Field key={k} label={`${k}K`} hint={prices.perGram[k] ? `now ${d(prices.perGram[k]).toFixed(0)}` : undefined}>
              <Input inputMode="decimal" className="tnum" value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} placeholder={prices.perGram[k] ? d(prices.perGram[k]).toFixed(0) : '—'} />
            </Field>
          ))}
        </div>
        {manualRows.length ? (
          <Button variant="ghost" full onClick={async () => { await remove.mutateAsync(manualRows.map((r) => r!.id)); onClose() }}>
            Remove my overrides
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
