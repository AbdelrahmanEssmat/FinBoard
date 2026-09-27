import { createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Droplets } from 'lucide-react'
import { Card, Divider, Skeleton } from '@/components/ui'
import { Amount, EmptyState, PageHeader, Section } from '@/components/shared'
import { useLiquidity } from '@/hooks/useLiquidity'
import { LIQUID_ACCOUNT_TYPES, LIQUID_TYPE_LABELS } from '@/domain/liquidity'
import { iconFor } from '@/utils/icons'

/** Liquid money in full: by currency, by type of place, by account (each balance), and what isn't counted. */
export default function LiquidityPage() {
  const navigate = useNavigate()
  const l = useLiquidity()

  if (l.isLoading) return <Skeleton className="h-48" />
  const excludedTotal = l.excluded.clouds.plus(l.excluded.platforms).plus(l.excluded.other)

  return (
    <div className="anim-fade-up">
      <PageHeader back title="Liquidity" subtitle="Money you can spend right now" />

      {!l.byAccount.length ? (
        <EmptyState icon={Droplets} title="No liquid money yet" description="Balances in Bank, Cash and Wallet / prepaid card accounts show here." />
      ) : (
        <div className="space-y-8">
          <Card padded>
            <div className="text-xs text-muted">Total liquid, in {l.display}</div>
            <Amount value={l.total} currency={l.display} size="xl" className="mt-1" />
            <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {l.byAccount.map((a) => (
                <span key={a.id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${Math.max(a.pct, 1.5)}%`, background: a.color }} />
              ))}
            </div>
          </Card>

          <Section title="By currency">
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              {l.byCurrency.map((c) => (
                <Card key={c.currency} padded>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{c.currency}</span>
                    <span className="text-xs text-muted">{c.pct.toFixed(0)}% of liquid</span>
                  </div>
                  <Amount value={c.amount} currency={c.currency} size="lg" className="mt-1.5" />
                  {c.currency !== l.display ? (
                    <div className="mt-0.5 text-xs text-muted">
                      ≈ <Amount value={c.base} currency={l.display} decimals={0} />
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </Section>

          <Section title="By type">
            <Card className="divide-y divide-border">
              {LIQUID_ACCOUNT_TYPES.filter((t) => l.byType[t].gt(0) || l.byAccount.some((a) => a.type === t)).map((t) => {
                const pct = l.total.gt(0) ? l.byType[t].div(l.total).times(100).toNumber() : 0
                return (
                  <div key={t} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[15px] font-medium">{LIQUID_TYPE_LABELS[t]}</span>
                      <Amount value={l.byType[t]} currency={l.display} className="text-sm font-semibold" />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, pct)}%` }} />
                      </div>
                      <span className="w-10 text-right text-[11px] text-muted">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </Card>
          </Section>

          <Section title="Where it is">
            <Card className="overflow-hidden">
              {l.byAccount.map((a, i) => (
                <div key={a.id}>
                  {i > 0 ? <Divider /> : null}
                  <button onClick={() => navigate(`/accounts/${a.id}`)} className="w-full px-5 py-4 text-left transition-colors hover:bg-surface-2 active:bg-surface-2">
                    <div className="flex items-center gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: a.color + '22', color: a.color }}>
                        {createElement(iconFor(a.icon), { className: 'h-[18px] w-[18px]' })}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{a.name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {LIQUID_TYPE_LABELS[a.type]} · {a.pct.toFixed(0)}%
                        </span>
                      </span>
                      <Amount value={a.base} currency={l.display} decimals={0} className="shrink-0 text-sm font-semibold" />
                    </div>
                    {/* each balance in its own currency */}
                    <div className="mt-2.5 flex flex-wrap gap-2 pl-[3.375rem]">
                      {a.balances.map((b) => (
                        <span key={b.subId} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                          <span className="text-muted">{b.label ?? b.currency}</span>
                          <Amount value={b.amount} currency={b.currency} className="font-medium" />
                        </span>
                      ))}
                    </div>
                  </button>
                </div>
              ))}
            </Card>
          </Section>

          {excludedTotal.gt(0) ? (
            <Section title="Not counted as liquid">
              <Card padded className="space-y-2 text-sm">
                {l.excluded.clouds.gt(0) ? <ExcludedRow label="Clouds (savings that earn interest)" value={l.excluded.clouds} display={l.display} /> : null}
                {l.excluded.platforms.gt(0) ? <ExcludedRow label="Cash on investment platforms" value={l.excluded.platforms} display={l.display} /> : null}
                {l.excluded.other.gt(0) ? <ExcludedRow label="“Other” accounts" value={l.excluded.other} display={l.display} /> : null}
                <p className="pt-1 text-xs leading-relaxed text-muted">
                  Certificates, stocks, funds and gold are never liquid. An account counts when its type is Bank, Cash or Wallet / prepaid card; change the type from the account&apos;s edit screen.
                </p>
              </Card>
            </Section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ExcludedRow({ label, value, display }: { label: string; value: import('@/domain/money').Decimal; display: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <Amount value={value} currency={display} decimals={0} className="shrink-0" />
    </div>
  )
}
