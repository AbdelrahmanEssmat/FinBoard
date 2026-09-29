import { useMemo, useState } from 'react'
import { Award, CalendarClock, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { Button, Card, Divider } from '@/components/ui'
import { Amount, ListRow, Section, StatCard } from '@/components/shared'
import { useConvert, useHistoricalConvert } from '@/hooks/useMoney'
import { byId, cn } from '@/utils'
import { d } from '@/domain/money'
import { formatDate, formatPercent } from '@/domain/format'
import { performanceSummary, saleReturnPct } from '@/domain/investments'
import { SaleDetailSheet } from '@/features/investments/components/SaleDetailSheet'
import type { Holding, HoldingSale, InvestmentCategory } from '@/api/database.types'

const SALES_PREVIEW = 8

/** Realized and unrealized profit, win rate, holding period, results by type, and the sales history. */
export function PerformanceSection({ holdings, sales, categories }: { holdings: Holding[]; sales: HoldingSale[]; categories: InvestmentCategory[] }) {
  const { toDisplayOrZero, display } = useConvert()
  const { toDisplayAt } = useHistoricalConvert()
  const [showAll, setShowAll] = useState(false)
  const [detail, setDetail] = useState<HoldingSale | null>(null)
  const holdingMap = useMemo(() => byId(holdings), [holdings])

  const p = useMemo(
    () => performanceSummary(sales, holdings, new Map(categories.map((c) => [c.id, { name: c.name }])), toDisplayAt, toDisplayOrZero),
    [sales, holdings, categories, toDisplayAt, toDisplayOrZero],
  )
  if (!sales.length && !holdings.some((h) => d(h.units).gt(0))) return null

  const nameOf = (s: HoldingSale) => holdingMap.get(s.holding_id)?.name ?? 'Sold holding'
  const tone = (v: { gte: (n: number) => boolean }) => (v.gte(0) ? 'text-positive' : 'text-negative')
  const shown = showAll ? sales : sales.slice(0, SALES_PREVIEW)

  return (
    <>
      <Section title="Performance">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard
            label="Realized profit"
            icon={p.realized.gte(0) ? TrendingUp : TrendingDown}
            iconClass={tone(p.realized)}
            value={p.trades ? <Amount value={p.realized} currency={display} showSign compact fit className={tone(p.realized)} /> : '—'}
            foot={p.trades ? `${p.realizedPct ? formatPercent(p.realizedPct) + ' · ' : ''}${p.trades} sale${p.trades === 1 ? '' : 's'}` : 'After you sell'}
          />
          <StatCard
            label="Unrealized"
            icon={p.unrealized.gte(0) ? TrendingUp : TrendingDown}
            iconClass={tone(p.unrealized)}
            value={p.openCost.gt(0) ? <Amount value={p.unrealized} currency={display} showSign compact fit className={tone(p.unrealized)} /> : '—'}
            foot={p.unrealizedPct ? `${formatPercent(p.unrealizedPct)} on open positions` : 'Nothing open'}
          />
          <StatCard
            label="Win rate"
            icon={Target}
            value={p.winRate !== null ? `${Math.round(p.winRate)}%` : '—'}
            foot={p.trades ? `${p.wins} of ${p.trades} in profit` : 'After you sell'}
          />
          <StatCard
            label="Avg. holding"
            icon={CalendarClock}
            value={p.avgHoldingDays !== null ? `${p.avgHoldingDays} day${p.avgHoldingDays === 1 ? '' : 's'}` : '—'}
            foot={p.avgHoldingDays !== null ? 'Bought to sold' : p.trades ? 'Add a "Bought on" date' : 'After you sell'}
          />
        </div>

        {p.trades >= 2 && p.best && p.worst ? (
          <Card className="mt-4 overflow-hidden">
            <ListRow
              icon={Award}
              color="#16a34a"
              title={`Best: ${nameOf(p.best)}`}
              subtitle={formatDate(p.best.date)}
              trailing={<Amount value={p.best.base} currency={display} showSign className={cn('font-semibold', tone(p.best.base))} />}
              onClick={() => setDetail(p.best)}
            />
            <Divider />
            <ListRow
              icon={TrendingDown}
              color="#dc2626"
              title={`Worst: ${nameOf(p.worst)}`}
              subtitle={formatDate(p.worst.date)}
              trailing={<Amount value={p.worst.base} currency={display} showSign className={cn('font-semibold', tone(p.worst.base))} />}
              onClick={() => setDetail(p.worst)}
            />
          </Card>
        ) : null}

        {p.byCategory.length > 1 || (p.byCategory.length === 1 && p.trades) ? (
          <Card className="mt-4 overflow-hidden">
            {p.byCategory.map((c, i) => {
              const total = c.realized.plus(c.unrealized)
              return (
                <div key={c.id}>
                  {i > 0 ? <Divider /> : null}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{c.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        Realized <Amount value={c.realized} currency={display} showSign compact /> · Open <Amount value={c.unrealized} currency={display} showSign compact />
                      </div>
                    </div>
                    <Amount value={total} currency={display} showSign className={cn('shrink-0 font-semibold', tone(total))} />
                  </div>
                </div>
              )
            })}
          </Card>
        ) : null}
      </Section>

      {sales.length ? (
        <Section
          title="Sales history"
          action={
            sales.length > SALES_PREVIEW ? (
              <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show less' : `All ${sales.length}`}
              </Button>
            ) : undefined
          }
        >
          <Card className="overflow-hidden">
            {shown.map((s, i) => {
              const pct = saleReturnPct(s)
              return (
                <div key={s.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    title={nameOf(s)}
                    subtitle={`${formatDate(s.date)} · ${d(s.units).toString()} × ${d(s.sell_price).toFixed(2)}`}
                    trailing={
                      <span className="flex flex-col items-end">
                        <Amount value={s.realized} currency={s.currency} showSign className={cn('font-semibold', tone(d(s.realized)))} />
                        {pct ? <span className={cn('text-xs', tone(pct))}>{formatPercent(pct)}</span> : null}
                      </span>
                    }
                    onClick={() => setDetail(s)}
                  />
                </div>
              )
            })}
          </Card>
        </Section>
      ) : null}

      <SaleDetailSheet sale={detail} name={detail ? nameOf(detail) : ''} onClose={() => setDetail(null)} />
    </>
  )
}
