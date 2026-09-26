import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, Card, Divider, Input } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { useHoldings } from '@/api/queries'
import { useUpdateRows } from '@/api/mutations'
import { d } from '@/domain/money'
import { toast } from '@/store/toasts'
import { cn } from '@/utils'

/** Edit every holding's current price on one screen. */
export default function UpdatePricesPage() {
  const navigate = useNavigate()
  const { data: all } = useHoldings()
  // sold-out holdings have no price to track
  const holdings = useMemo(() => all?.filter((h) => d(h.units).gt(0)), [all])
  // partial update: only the price columns change (an upsert would need every required column)
  const upsert = useUpdateRows('holdings', { silent: true })
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
        {(holdings ?? []).map((h, i) => {
          const edited = prices[h.id] !== undefined && d(prices[h.id]).toString() !== d(h.current_price).toString()
          return (
            <div key={h.id}>
              {i > 0 ? <Divider /> : null}
              {/* Name and previous price take the free space; the price field has a fixed width and never squeezes them */}
              <label className="flex items-center gap-4 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {h.name}
                    {h.ticker ? <span className="ml-1.5 text-xs font-normal text-muted">{h.ticker}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    Was {d(h.current_price).toFixed(2)} {h.currency}
                  </span>
                </span>
                <span className="w-28 shrink-0 sm:w-36">
                  <Input
                    inputMode="decimal"
                    enterKeyHint="next"
                    aria-label={`New price for ${h.name}`}
                    className={cn('tnum h-11 text-right', edited && 'border-accent')}
                    value={prices[h.id] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [h.id]: e.target.value })}
                    onFocus={(e) => e.target.select()}
                  />
                </span>
              </label>
            </div>
          )
        })}
        {!holdings?.length ? <p className="p-5 text-sm text-muted">No holdings yet.</p> : null}
      </Card>
    </div>
  )
}
