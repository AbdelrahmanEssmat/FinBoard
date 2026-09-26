import { useMemo } from 'react'
import { ArrowLeftRight, Inbox } from 'lucide-react'
import { Amount, Card, Divider, EmptyState, ListRow } from '@/components/ui'
import { useAccounts, useCategories, useSubAccounts } from '@/lib/data/tables'
import { byId, groupBy } from '@/lib/utils'
import { iconFor } from '@/lib/icons'
import { formatDate, todayIso } from '@/domain/format'
import { addDaysIso } from '@/lib/utils'
import type { Transaction } from '@/lib/database.types'

export function TransactionList({ transactions, onSelect, emptyText, grouped = true }: { transactions: Transaction[]; onSelect?: (t: Transaction) => void; emptyText?: string; grouped?: boolean }) {
  const { data: categories } = useCategories()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const cats = useMemo(() => byId(categories), [categories])
  const subMap = useMemo(() => byId(subs), [subs])
  const accMap = useMemo(() => byId(accounts), [accounts])

  if (!transactions.length) return <EmptyState icon={Inbox} title="Nothing here yet" description={emptyText ?? 'Add an expense, income or transfer with the + button.'} />

  const today = todayIso()
  const yesterday = addDaysIso(today, -1)
  const dayLabel = (iso: string) => (iso === today ? 'Today' : iso === yesterday ? 'Yesterday' : formatDate(iso, 'EEE, d MMM yyyy'))
  const groups = grouped ? groupBy(transactions, (t) => t.date) : { all: transactions }

  const accountName = (subId: string) => {
    const s = subMap.get(subId)
    const a = s ? accMap.get(s.account_id) : undefined
    return a ? `${a.name}${s && s.name ? ' · ' + s.name : ''}` : '—'
  }

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([day, items]) => (
        <section key={day}>
          {grouped ? <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(day)}</h3> : null}
          <Card className="overflow-hidden">
            {items.map((t, i) => {
              const cat = t.category_id ? cats.get(t.category_id) : undefined
              const isTransfer = t.type === 'transfer'
              const Icon = isTransfer ? ArrowLeftRight : iconFor(cat?.icon)
              const color = isTransfer ? '#64748b' : cat?.color ?? '#94a3b8'
              const title = t.payee || t.notes || cat?.name || (isTransfer ? 'Transfer' : t.type === 'income' ? 'Income' : 'Expense')
              const subtitle = isTransfer
                ? `${accountName(t.sub_account_id)} → ${t.to_sub_account_id ? accountName(t.to_sub_account_id) : '?'}`
                : [cat?.name, accountName(t.sub_account_id)].filter(Boolean).join(' · ')
              return (
                <div key={t.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon={Icon}
                    color={color}
                    title={title}
                    subtitle={subtitle}
                    onClick={onSelect ? () => onSelect(t) : undefined}
                    trailing={
                      isTransfer ? (
                        <span className="flex flex-col items-end">
                          <Amount value={t.amount} currency={t.currency} className="text-sm font-medium" />
                          {t.to_currency && t.to_currency !== t.currency ? <Amount value={t.to_amount ?? 0} currency={t.to_currency} size="sm" className="text-muted" /> : null}
                        </span>
                      ) : (
                        <Amount value={t.type === 'expense' ? -t.amount : t.amount} currency={t.currency} colored showSign className="font-semibold" />
                      )
                    }
                  />
                </div>
              )
            })}
          </Card>
        </section>
      ))}
    </div>
  )
}
