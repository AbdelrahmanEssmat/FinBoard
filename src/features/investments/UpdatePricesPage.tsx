import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, Card, Divider, Input } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { useHoldings } from '@/api/queries'
import { useUpsert } from '@/api/mutations'
import { d } from '@/domain/money'
import { toast } from '@/store/toasts'

/** Edit every holding's current price on one screen. */
export default function UpdatePricesPage() {
  const navigate = useNavigate()
  const { data: holdings } = useHoldings()
  const upsert = useUpsert('holdings', { silent: true })
  const [prices, setPrices] = useState<Record<string, string>>({})

  useEffect(() => {
    if (holdings) setPrices(Object.fromEntries(holdings.map((h) => [h.id, String(h.current_price)])))
  }, [holdings])

  const changed = (holdings ?? []).filter((h) => prices[h.id] !== undefined && d(prices[h.id]).toString() !== d(h.current_price).toString())

  const save = async () => {
    if (!changed.length) return
    const now = new Date().toISOString()
    await upsert.mutateAsync(changed.map((h) => ({ id: h.id, current_price: d(prices[h.id]).toFixed(6), price_updated_at: now })))
    toast.success(`Updated ${changed.length} price${changed.length > 1 ? 's' : ''}`)
    navigate(-1)
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Update prices"
        subtitle="Type the latest price for each holding"
        action={
          <Button size="sm" onClick={save} loading={upsert.isPending} disabled={!changed.length}>
            Save {changed.length ? `(${changed.length})` : ''}
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {(holdings ?? []).map((h, i) => (
          <div key={h.id}>
            {i > 0 ? <Divider /> : null}
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{h.name}</div>
                <div className="text-xs text-muted">
                  {h.ticker ? h.ticker + ' · ' : ''}was {d(h.current_price).toFixed(2)} {h.currency}
                </div>
              </div>
              <Input inputMode="decimal" className="tnum w-32 text-right" value={prices[h.id] ?? ''} onChange={(e) => setPrices({ ...prices, [h.id]: e.target.value })} onFocus={(e) => e.target.select()} />
            </div>
          </div>
        ))}
        {!holdings?.length ? <p className="p-5 text-sm text-muted">No holdings yet.</p> : null}
      </Card>
    </div>
  )
}
