import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card } from '@/components/ui'
import { Amount } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { formatDate, formatMoney } from '@/domain/format'
import type { Decimal } from '@/domain/money'
import { relativeTime } from '@/utils'
import type { HistoryPoint } from '@/features/dashboard/useNetWorthHistory'

export function NetWorthCard({ total, change, history, display, ratesUpdatedAt }: { total: Decimal; change: Decimal | null; history: HistoryPoint[]; display: string; ratesUpdatedAt: string | null }) {
  const privacy = usePrefs((s) => s.privacy)
  return (
    <Card padded className="overflow-hidden">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">Net worth</div>
      <Amount value={total} currency={display} size="xl" className="mt-1.5 block" />
      <div className="mt-2 flex items-center gap-2 text-sm">
        {change ? (
          <>
            <Amount value={change} currency={display} colored showSign className="font-medium" />
            <span className="text-muted">last 30 days</span>
          </>
        ) : (
          <span className="text-muted">Tracking starts today</span>
        )}
      </div>
      {history.length > 1 ? (
        <div className={`-mx-2 mt-4 h-24 ${privacy ? 'privacy-blur' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: 'var(--color-border)' }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg bg-text px-2.5 py-1.5 text-xs text-bg">
                      {formatDate(payload[0]!.payload.date)} · {formatMoney(payload[0]!.value as number, display)}
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={2} fill="url(#nw)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {ratesUpdatedAt ? <div className="mt-3 text-[11px] text-faint">Rates updated {relativeTime(ratesUpdatedAt)}</div> : null}
    </Card>
  )
}
