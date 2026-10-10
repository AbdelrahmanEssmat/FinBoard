import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coins, HandCoins, TrendingUp, type LucideIcon } from 'lucide-react'
import { Card, Divider } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import { formatPercent } from '@/domain/format'
import type { Decimal } from '@/domain/money'
import type { PeriodInvestments } from '@/domain/investments'

const tone = (v: Decimal) => (v.gt(0) ? 'text-positive' : v.lt(0) ? 'text-negative' : 'text-muted')

/** Stocks and funds: what they are worth today and what was sold in the period. Part of net worth, not income or spending. */
export function InvestmentsCard({ data, display }: { data: PeriodInvestments | null; display: string }) {
  const navigate = useNavigate()
  if (!data?.any) return null
  const rows: { key: string; icon: LucideIcon; label: string; hint: ReactNode; value: ReactNode }[] = []
  if (data.holdings > 0) {
    rows.push({
      key: 'worth',
      icon: TrendingUp,
      label: 'Worth today',
      hint: data.unrealized.isZero() ? (
        `${data.holdings} holding${data.holdings === 1 ? '' : 's'} at the latest prices`
      ) : (
        <span className={tone(data.unrealized)}>
          <Amount value={data.unrealized} currency={display} showSign size="sm" />
          {data.unrealizedPct ? ` (${formatPercent(data.unrealizedPct)})` : ''} not sold yet
        </span>
      ),
      value: <Amount value={data.value} currency={display} className="shrink-0 text-sm font-semibold" />,
    })
  }
  if (data.sales > 0) {
    rows.push({
      key: 'sold',
      icon: HandCoins,
      label: 'Sold',
      hint: `${data.sales} sale${data.sales === 1 ? '' : 's'} in this period, after fees`,
      value: <Amount value={data.sold} currency={display} className="shrink-0 text-sm font-semibold" />,
    })
    rows.push({
      key: 'realized',
      icon: Coins,
      label: data.realized.lt(0) ? 'Loss on sales' : 'Profit on sales',
      hint: data.realizedPct ? `${formatPercent(data.realizedPct)} on what you paid` : 'On what you paid',
      value: <Amount value={data.realized} currency={display} showSign className={`shrink-0 text-sm font-semibold ${tone(data.realized)}`} />,
    })
  }
  return (
    <Section
      title="Stocks and funds"
      action={
        <button onClick={() => navigate('/investments')} className="-my-1.5 -mr-2 flex min-h-11 items-center px-2 text-xs font-medium text-accent">
          Open investments
        </button>
      }
    >
      <Card className="overflow-hidden">
        {rows.map((r, i) => (
          <div key={r.key}>
            {i > 0 ? <Divider /> : null}
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                <r.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{r.label}</div>
                <div className="text-xs text-muted">{r.hint}</div>
              </div>
              {r.value}
            </div>
          </div>
        ))}
        <Divider />
        <p className="px-5 py-3 text-xs text-muted">Buying and selling isn’t income or spending, so it’s not in the totals above. Stocks and funds count in your net worth and in their platform’s total at the latest prices.</p>
      </Card>
    </Section>
  )
}
