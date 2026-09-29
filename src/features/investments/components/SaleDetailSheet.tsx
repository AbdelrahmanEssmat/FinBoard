import { useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Button, ConfirmDialog, Sheet } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useAccounts, useSubAccounts } from '@/api/queries'
import { useUndoableDelete } from '@/api/mutations'
import { byId, cn } from '@/utils'
import { d } from '@/domain/money'
import { formatDate, formatPercent } from '@/domain/format'
import { annualizedReturn, holdingDays, saleReturnPct } from '@/domain/investments'
import type { HoldingSale } from '@/api/database.types'

/** Everything about one sale, with the option to undo it. */
export function SaleDetailSheet({ sale, name, onClose }: { sale: HoldingSale | null; name: string; onClose: () => void }) {
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const subMap = useMemo(() => byId(subs), [subs])
  const accMap = useMemo(() => byId(accounts), [accounts])
  const remove = useUndoableDelete('holding_sales', { label: 'Sale', invalidate: ['holdings', 'transactions', 'sub_accounts'] })
  const [confirm, setConfirm] = useState(false)

  if (!sale) return null
  const pct = saleReturnPct(sale)
  const days = holdingDays(sale)
  const yearly = annualizedReturn(sale)
  const sub = sale.sub_account_id ? subMap.get(sale.sub_account_id) : undefined
  const gain = d(sale.realized).gte(0)

  const rows: [string, React.ReactNode][] = [
    ['Date sold', formatDate(sale.date)],
    ['Units', d(sale.units).toString()],
    ['Buy price', <Amount key="b" value={sale.avg_cost} currency={sale.currency} />],
    ['Sell price', <Amount key="s" value={sale.sell_price} currency={sale.currency} />],
    ['You paid', <Amount key="c" value={sale.cost_basis} currency={sale.currency} />],
    ...(d(sale.fees).gt(0) ? ([['Fees', <Amount key="f" value={sale.fees} currency={sale.currency} />]] as [string, React.ReactNode][]) : []),
    ['You received', <Amount key="p" value={sale.proceeds} currency={sale.currency} />],
    ...(sale.bought_at ? ([['Bought on', formatDate(sale.bought_at)]] as [string, React.ReactNode][]) : []),
    ...(days !== null ? ([['Held for', `${days} day${days === 1 ? '' : 's'}`]] as [string, React.ReactNode][]) : []),
    ...(yearly ? ([['Yearly equivalent', formatPercent(yearly)]] as [string, React.ReactNode][]) : []),
    ['Money went to', sub ? `${accMap.get(sub.account_id)?.name ?? ''} · ${sub.currency}${sub.name ? ' · ' + sub.name : ''}` : 'Not recorded in an account'],
  ]

  return (
    <Sheet
      open={!!sale}
      onClose={onClose}
      title={name}
      footer={
        <Button full variant="secondary" size="lg" onClick={() => setConfirm(true)}>
          <Undo2 className="h-4 w-4" /> Undo this sale
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl bg-surface-2 p-5 text-center">
          <div className="text-xs font-medium text-muted">{gain ? 'Profit' : 'Loss'}</div>
          <Amount value={sale.realized} currency={sale.currency} showSign size="lg" className={cn('mt-1 block tracking-tight', gain ? 'text-positive' : 'text-negative')} />
          {pct ? <div className={cn('mt-1 text-sm font-medium', gain ? 'text-positive' : 'text-negative')}>{formatPercent(pct)} on what you paid</div> : null}
        </div>
        <dl className="divide-y divide-border rounded-2xl border border-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-muted">{label}</dt>
              <dd className="tnum min-w-0 truncate text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {sale.notes ? <p className="text-sm leading-relaxed text-muted">{sale.notes}</p> : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Undo this sale?"
        message={`The ${d(sale.units).toString()} units go back into the holding${sale.transaction_id ? ' and the money received is taken back out of the account' : ''}.`}
        confirmLabel="Undo sale"
        onConfirm={() => {
          remove(sale, 'Sale undone')
          onClose()
        }}
      />
    </Sheet>
  )
}
