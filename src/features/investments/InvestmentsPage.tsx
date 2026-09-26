import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, RefreshCw, Settings2, TrendingUp } from 'lucide-react'
import { Amount, Button, Card, Divider, EmptyState, ListRow, PageHeader, SectionTitle } from '@/components/ui'
import { useHoldings, useInvestmentCategories } from '@/lib/data/tables'
import { useConvert } from '@/lib/data/derived'
import { d } from '@/domain/money'
import { formatPercent } from '@/domain/format'
import { relativeTime } from '@/lib/utils'
import { HoldingForm } from './HoldingForm'
import { InvestmentCategoriesSheet } from './InvestmentCategoriesSheet'
import type { Holding } from '@/lib/database.types'

export default function InvestmentsPage() {
  const navigate = useNavigate()
  const { data: holdings } = useHoldings()
  const { data: categories } = useInvestmentCategories()
  const { toDisplayOrZero, display } = useConvert()
  const [form, setForm] = useState<{ open: boolean; item?: Holding | null }>({ open: false })
  const [cats, setCats] = useState(false)

  const rows = useMemo(
    () =>
      (holdings ?? []).map((h) => {
        const value = d(h.units).times(d(h.current_price))
        const cost = d(h.units).times(d(h.avg_cost))
        const pl = value.minus(cost)
        return { h, value, cost, pl, plPct: cost.isZero() ? null : pl.div(cost).times(100), valueDisplay: toDisplayOrZero(value, h.currency), costDisplay: toDisplayOrZero(cost, h.currency) }
      }),
    [holdings, toDisplayOrZero],
  )
  const total = rows.reduce((a, r) => a.plus(r.valueDisplay), d(0))
  const totalCost = rows.reduce((a, r) => a.plus(r.costDisplay), d(0))
  const totalPl = total.minus(totalCost)
  const lastUpdate = (holdings ?? []).map((h) => h.price_updated_at).filter(Boolean).sort().pop() ?? null
  const groups = (categories ?? []).map((c) => ({ c, rows: rows.filter((r) => r.h.category_id === c.id) })).filter((g) => g.rows.length)
  const uncategorised = rows.filter((r) => !r.h.category_id || !categories?.some((c) => c.id === r.h.category_id))

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Investments"
        subtitle={lastUpdate ? `Prices updated ${relativeTime(lastUpdate)}` : undefined}
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Categories" onClick={() => setCats(true)}>
              <Settings2 className="h-5 w-5" />
            </Button>
            <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        }
      />
      {!holdings?.length ? (
        <EmptyState icon={TrendingUp} title="No holdings yet" description="Add your Thndr stocks, funds and gold funds. Update prices manually whenever you like." action={<Button onClick={() => setForm({ open: true, item: null })}>Add holding</Button>} />
      ) : (
        <div className="space-y-6">
          <Card className="p-5">
            <div className="text-xs text-muted">Market value</div>
            <Amount value={total} currency={display} size="xl" />
            <div className="mt-1 flex items-center gap-2 text-sm">
              <Amount value={totalPl} currency={display} colored showSign className="font-medium" />
              {!totalCost.isZero() ? <span className={totalPl.gte(0) ? 'text-positive' : 'text-negative'}>({formatPercent(totalPl.div(totalCost).times(100))})</span> : null}
            </div>
            <Button className="mt-4" variant="soft" size="sm" onClick={() => navigate('/investments/prices')}>
              <RefreshCw className="h-4 w-4" /> Update prices
            </Button>
          </Card>
          {[...groups, ...(uncategorised.length ? [{ c: { id: 'none', name: 'Uncategorised' }, rows: uncategorised }] : [])].map((g) => (
            <div key={g.c.id}>
              <SectionTitle>{g.c.name}</SectionTitle>
              <Card className="overflow-hidden">
                {g.rows.map((r, i) => (
                  <div key={r.h.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow
                      title={
                        <span>
                          {r.h.name}
                          {r.h.ticker ? <span className="ml-1.5 text-xs text-muted">{r.h.ticker}</span> : null}
                        </span>
                      }
                      subtitle={`${d(r.h.units).toString()} × ${d(r.h.current_price).toFixed(2)} ${r.h.currency}`}
                      trailing={
                        <span className="flex flex-col items-end">
                          <Amount value={r.value} currency={r.h.currency} className="font-semibold" />
                          <span className={`text-xs ${r.pl.gte(0) ? 'text-positive' : 'text-negative'}`}>
                            <Amount value={r.pl} currency={r.h.currency} showSign size="sm" /> {r.plPct ? `(${formatPercent(r.plPct)})` : ''}
                          </span>
                        </span>
                      }
                      onClick={() => setForm({ open: true, item: r.h })}
                    />
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
      <HoldingForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
      <InvestmentCategoriesSheet open={cats} onClose={() => setCats(false)} />
    </div>
  )
}
