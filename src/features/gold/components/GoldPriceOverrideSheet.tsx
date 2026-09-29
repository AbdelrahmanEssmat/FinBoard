import { useEffect, useState } from 'react'
import { Button, Field, Input, Sheet } from '@/components/ui'
import { useGoldPriceTable } from '@/hooks/useGoldPrices'
import { useUpsert, useDeleteRows } from '@/api/mutations'
import { useUserId } from '@/app/providers/AuthProvider'
import { newId } from '@/utils/ids'
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

  // only prices typed in here (automatic prices are also saved under the user's account)
  const manualRows = KARATS.map((k) => prices.rows[k]).filter((r) => r && r.source === 'manual')

  const save = async () => {
    if (!userId) return
    const now = new Date().toISOString()
    const rows = KARATS.filter((k) => d(values[k]).gt(0)).map((k) => ({
      id: newId(),
      user_id: userId,
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
        <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!userId}>
          Save override
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <p className="text-sm text-muted">Enter the price per gram in EGP. Your price is used for the next 24 hours, then automatic prices take over again.</p>
        <div className="grid grid-cols-2 gap-4">
          {KARATS.map((k) => (
            <Field key={k} label={`${k}K`} hint={prices.perGram[k] ? `now ${d(prices.perGram[k]).toFixed(0)}` : undefined}>
              <Input inputMode="decimal" className="tnum" value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} placeholder={prices.perGram[k] ? d(prices.perGram[k]).toFixed(0) : '—'} />
            </Field>
          ))}
        </div>
        {manualRows.length ? (
          <Button variant="ghost" full loading={remove.isPending} onClick={async () => { await remove.mutateAsync(manualRows.map((r) => r!.id)); onClose() }}>
            Remove my overrides
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
