import { createElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Droplets } from 'lucide-react'
import { Card } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useLiquidity } from '@/hooks/useLiquidity'
import { LIQUID_TYPE_LABELS } from '@/domain/liquidity'
import { iconFor } from '@/utils/icons'

const SHOWN_ACCOUNTS = 4

/** Home: how much you can spend right now, in which currencies, and where it sits. */
export function LiquidityCard() {
  const navigate = useNavigate()
  const l = useLiquidity()
  if (l.isLoading) return null

  return (
    <Card padded>
      <button onClick={() => navigate('/liquidity')} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <Droplets className="h-4 w-4 text-accent" /> Liquid money
        </span>
        <span className="flex items-center gap-0.5 text-xs font-medium text-accent">
          Details <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
      <Amount value={l.total} currency={l.display} size="lg" className="mt-1.5" />
      <p className="text-xs text-muted">Banks, cash and wallets you can spend any time</p>

      {l.byCurrency.length ? (
        <>
          {/* one chip per currency, in that currency */}
          <div className="mt-4 flex flex-wrap gap-2">
            {l.byCurrency.map((c) => (
              <span key={c.currency} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs">
                <span className="font-semibold text-muted">{c.currency}</span>
                <Amount value={c.amount} currency={c.currency} decimals={0} className="font-semibold" />
                <span className="text-faint">{c.pct.toFixed(0)}%</span>
              </span>
            ))}
          </div>

          {/* where it sits: one segment per account */}
          <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {l.byAccount.map((a) => (
              <span key={a.id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${Math.max(a.pct, 1.5)}%`, background: a.color }} />
            ))}
          </div>

          <div className="mt-3 divide-y divide-border">
            {l.byAccount.slice(0, SHOWN_ACCOUNTS).map((a) => (
              <button key={a.id} onClick={() => navigate(`/accounts/${a.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: a.color + '22', color: a.color }}>
                  {createElement(iconFor(a.icon), { className: 'h-4 w-4' })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {LIQUID_TYPE_LABELS[a.type]} · {a.pct.toFixed(0)}%
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  {a.balances
                    .filter((b) => !b.amount.isZero() || a.balances.length === 1)
                    .map((b) => (
                      <Amount key={b.subId} value={b.amount} currency={b.currency} decimals={0} className="text-sm font-semibold leading-5" />
                    ))}
                </span>
              </button>
            ))}
          </div>
          {l.byAccount.length > SHOWN_ACCOUNTS ? (
            <button onClick={() => navigate('/liquidity')} className="mt-1 text-xs font-medium text-accent">
              +{l.byAccount.length - SHOWN_ACCOUNTS} more
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">No bank, cash or wallet balances yet.</p>
      )}
    </Card>
  )
}
