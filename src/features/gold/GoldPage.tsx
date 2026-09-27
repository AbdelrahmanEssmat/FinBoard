import { useMemo, useState } from 'react'
import { Gem, Pencil, Plus, RefreshCw } from 'lucide-react'
import { Amount, EmptyState, ListRow, PageHeader, SectionTitle } from '@/components/shared'
import { Button, Card, Divider, Pill } from '@/components/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useGoldItems } from '@/api/queries'
import { refreshGoldPrices } from '@/api/goldProvider'
import { useUserId } from '@/app/providers/AuthProvider'
import { toast } from '@/store/toasts'
import { cn } from '@/utils'
import { useConvert } from '@/hooks/useMoney'
import { useGoldPriceTable } from '@/hooks/useGoldPrices'
import { goldItemCost, goldItemValue, goldSummary, KARATS } from '@/domain/gold'
import { formatDate, formatPercent } from '@/domain/format'
import { relativeTime } from '@/utils'
import { d } from '@/domain/money'
import { GoldItemForm } from '@/features/gold/components/GoldItemForm'
import { GoldPriceOverrideSheet } from '@/features/gold/components/GoldPriceOverrideSheet'
import type { GoldItem } from '@/api/database.types'

const TYPE_LABEL = { bar: 'Bar', coin: 'Coin', jewelry: 'Jewelry' }

export default function GoldPage() {
  const { data: items } = useGoldItems()
  const prices = useGoldPriceTable()
  const { toDisplayOrZero, display } = useConvert()
  const [form, setForm] = useState<{ open: boolean; item?: GoldItem | null }>({ open: false })
  const [override, setOverride] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const userId = useUserId()
  const qc = useQueryClient()

  const refresh = async () => {
    setRefreshing(true)
    try {
      const r = await refreshGoldPrices(userId, { force: true })
      if (r.status === 'saved') {
        await qc.invalidateQueries({ queryKey: ['gold_prices'] })
        toast.success(`Gold prices updated from ${r.sourceName}`)
      } else if (r.status === 'manual') {
        toast.info('Your manual price is in use for 24 hours. Remove it (pencil button) to use live prices.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch gold prices')
    } finally {
      setRefreshing(false)
    }
  }

  const summary = useMemo(() => goldSummary(items ?? [], prices), [items, prices])
  const valueDisplay = toDisplayOrZero(summary.value, 'EGP')
  const costDisplay = (items ?? []).reduce((a, it) => a.plus(toDisplayOrZero(goldItemCost(it), it.purchase_currency)), d(0))
  const gainDisplay = valueDisplay.minus(costDisplay)

  const sourceLabel = prices.source === 'local' ? `Egyptian market · ${prices.sourceName ?? ''}` : prices.source === 'global' ? 'Global spot × USD/EGP (fallback)' : prices.source === 'manual' ? 'Manual override' : 'No price yet'

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Gold"
        action={
          <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      <Card padded className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">Price per gram (EGP)</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {KARATS.map((k) => (
                <div key={k}>
                  <span className="text-xs text-muted">{k}K </span>
                  <span className="tnum font-semibold">{prices.perGram[k] ? d(prices.perGram[k]).toFixed(0) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0">
            <button onClick={refresh} disabled={refreshing} aria-label="Refresh gold prices" className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-60">
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <button onClick={() => setOverride(true)} aria-label="Override price" className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Pill tone={prices.source === 'local' ? 'positive' : prices.source === 'global' ? 'warning' : 'neutral'}>{sourceLabel}</Pill>
          {prices.priceAt ? <span>updated {relativeTime(prices.priceAt)}</span> : null}
        </div>
      </Card>

      {!items?.length ? (
        <EmptyState icon={Gem} title="No gold yet" description="Add bars, coins or jewelry by karat and weight. Value uses Egyptian local prices per gram." action={<Button onClick={() => setForm({ open: true, item: null })}>Add gold</Button>} />
      ) : (
        <div className="space-y-8">
          <Card padded>
            <div className="text-xs text-muted">Current value · {summary.grams.toFixed(2)} g</div>
            <Amount value={valueDisplay} currency={display} size="xl" />
            <div className="mt-1 text-sm">
              <Amount value={gainDisplay} currency={display} colored showSign className="font-medium" />
              {!costDisplay.isZero() ? <span className={`ml-1 ${gainDisplay.gte(0) ? 'text-positive' : 'text-negative'}`}>({formatPercent(gainDisplay.div(costDisplay).times(100))})</span> : null}
              <span className="ml-2 text-muted">
                cost <Amount value={costDisplay} currency={display} size="sm" />
              </span>
            </div>
            {summary.missingPrice ? <p className="mt-2 text-xs text-warning">Some items have no price for their karat yet.</p> : null}
          </Card>
          <div>
            <SectionTitle>Holdings</SectionTitle>
            <Card className="overflow-hidden">
              {items.map((it, i) => {
                const value = goldItemValue(it, prices)
                const cost = goldItemCost(it)
                return (
                  <div key={it.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow
                      icon={Gem}
                      color="#ca8a04"
                      title={it.name || `${TYPE_LABEL[it.type]} ${it.karat}K`}
                      subtitle={`${d(it.weight_grams).toString()} g · ${it.karat}K${it.purchase_date ? ' · bought ' + formatDate(it.purchase_date) : ''}${it.workmanship_cost ? ' · +workmanship' : ''}`}
                      trailing={
                        <span className="flex flex-col items-end">
                          {value ? <Amount value={value} currency="EGP" className="font-semibold" /> : <span className="text-xs text-faint">no price</span>}
                          {value && !cost.isZero() && it.purchase_currency === 'EGP' ? <Amount value={value.minus(cost)} currency="EGP" colored showSign size="sm" /> : null}
                        </span>
                      }
                      onClick={() => setForm({ open: true, item: it })}
                    />
                  </div>
                )
              })}
            </Card>
          </div>
        </div>
      )}
      <GoldItemForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
      <GoldPriceOverrideSheet open={override} onClose={() => setOverride(false)} />
    </div>
  )
}
