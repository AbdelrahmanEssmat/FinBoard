import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, Settings2 } from 'lucide-react'
import { Button, Card, Divider } from '@/components/ui'
import { Amount, ListRow, PageHeader, Section } from '@/components/shared'
import { useAccounts, useHoldings, useInvestmentCategories, useSubAccounts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d } from '@/domain/money'
import { formatPercent } from '@/domain/format'
import { relativeTime } from '@/utils'
import { HoldingForm } from '@/features/investments/components/HoldingForm'
import { InvestmentCategoriesSheet } from '@/features/investments/components/InvestmentCategoriesSheet'
import { CloudsSection } from '@/features/investments/components/CloudsSection'
import { useClouds } from '@/features/investments/useClouds'
import type { Holding } from '@/api/database.types'

export default function InvestmentsPage() {
  const navigate = useNavigate()
  const { data: holdings } = useHoldings()
  const { data: categories } = useInvestmentCategories()
  const { toDisplayOrZero, display } = useConvert()
  const clouds = useClouds()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  // uninvested cash sitting on investment platforms (net worth counts it as investments too)
  const platformCash = useMemo(() => {
    const platformIds = new Set((accounts ?? []).filter((a) => a.type === 'investment' && !a.is_archived).map((a) => a.id))
    return (subs ?? []).filter((s) => platformIds.has(s.account_id) && s.yield_rate === null && !s.is_archived).reduce((a, s) => a.plus(toDisplayOrZero(s.balance, s.currency)), d(0))
  }, [accounts, subs, toDisplayOrZero])
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
  const holdingsValue = rows.reduce((a, r) => a.plus(r.valueDisplay), d(0))
  const holdingsCost = rows.reduce((a, r) => a.plus(r.costDisplay), d(0))
  const holdingsPl = holdingsValue.minus(holdingsCost)
  const total = holdingsValue.plus(clouds.total).plus(platformCash)
  const lastUpdate = (holdings ?? []).map((h) => h.price_updated_at).filter(Boolean).sort().pop() ?? null
  const groups = (categories ?? []).map((c) => ({ c, rows: rows.filter((r) => r.h.category_id === c.id) })).filter((g) => g.rows.length)
  const uncategorised = rows.filter((r) => !r.h.category_id || !categories?.some((c) => c.id === r.h.category_id))

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Investments"
        subtitle={lastUpdate ? `Prices updated ${relativeTime(lastUpdate)}` : undefined}
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Categories" onClick={() => setCats(true)}>
              <Settings2 className="h-5 w-5" />
            </Button>
            <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
              <Plus className="h-4 w-4" /> Holding
            </Button>
          </div>
        }
      />

      <div className="space-y-8">
        <Card padded>
          <div className="text-xs text-muted">Invested value</div>
          <Amount value={total} currency={display} size="xl" />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">
              Holdings <Amount value={holdingsValue} currency={display} className="font-medium text-text" compact />
              {!holdingsCost.isZero() ? (
                <span className={holdingsPl.gte(0) ? ' text-positive' : ' text-negative'}>
                  {' '}
                  <Amount value={holdingsPl} currency={display} showSign size="sm" /> ({formatPercent(holdingsPl.div(holdingsCost).times(100))})
                </span>
              ) : null}
            </span>
            {!platformCash.isZero() ? (
              <span className="text-muted">
                Cash <Amount value={platformCash} currency={display} className="font-medium text-text" compact />
              </span>
            ) : null}
            <span className="text-muted">
              Clouds <Amount value={clouds.total} currency={display} className="font-medium text-text" compact />
              {clouds.projectedMonthlyDisplay.gt(0) ? (
                <span className="text-positive">
                  {' '}
                  +<Amount value={clouds.projectedMonthlyDisplay} currency={display} size="sm" />/mo
                </span>
              ) : null}
            </span>
          </div>
          {rows.length ? (
            <Button className="mt-5" variant="soft" size="sm" onClick={() => navigate('/investments/prices')}>
              <RefreshCw className="h-4 w-4" /> Update prices
            </Button>
          ) : null}
        </Card>

        <CloudsSection />

        {!rows.length ? (
          <Section title="Holdings">
            <Card padded className="text-sm leading-relaxed text-muted">
              No stocks or funds yet. Add your Thndr holdings with units, average cost and the latest price to track profit and loss.
              <div className="mt-3">
                <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
                  Add holding
                </Button>
              </div>
            </Card>
          </Section>
        ) : (
          [...groups, ...(uncategorised.length ? [{ c: { id: 'none', name: 'Uncategorised' }, rows: uncategorised }] : [])].map((g) => (
            <Section key={g.c.id} title={g.c.name}>
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
            </Section>
          ))
        )}
      </div>
      <HoldingForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
      <InvestmentCategoriesSheet open={cats} onClose={() => setCats(false)} />
    </div>
  )
}
