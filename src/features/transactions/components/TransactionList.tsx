import { useMemo } from 'react'
import { ArrowLeftRight, Inbox } from 'lucide-react'
import { Amount, EmptyState, ListRow } from '@/components/shared'
import { Card, Divider } from '@/components/ui'
import { useAccounts, useCategories, useSubAccounts } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { isExpense, isIncome } from '@/domain/insights'
import { d } from '@/domain/money'
import { byId, groupBy } from '@/utils'
import { iconFor } from '@/utils/icons'
import { formatDate, todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'
import type { Transaction } from '@/api/database.types'

export function TransactionList({ transactions, onSelect, emptyText, grouped = true }: { transactions: Transaction[]; onSelect?: (t: Transaction) => void; emptyText?: string; grouped?: boolean }) {
  const { data: categories } = useCategories()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const cats = useMemo(() => byId(categories), [categories])
  const subMap = useMemo(() => byId(subs), [subs])
  const accMap = useMemo(() => byId(accounts), [accounts])
  const { toDisplayAt, display } = useHistoricalConvert()

  if (!transactions.length) return <EmptyState icon={Inbox} title="Nothing here yet" description={emptyText ?? 'Add an expense, income or transfer with the + button.'} />

  const today = todayIso()
  const yesterday = addDaysIso(today, -1)
  const dayLabel = (iso: string) => (iso === today ? 'Today' : iso === yesterday ? 'Yesterday' : formatDate(iso, 'EEE, d MMM yyyy'))
  const groups = grouped ? groupBy(transactions, (t) => t.date) : { all: transactions }

  // "Parent › Sub" for sub-categories, so the detail isn't lost in the list
  const categoryName = (id: string | null) => {
    const cat = id ? cats.get(id) : undefined
    if (!cat) return undefined
    const parent = cat.parent_id ? cats.get(cat.parent_id) : undefined
    return parent ? `${parent.name} › ${cat.name}` : cat.name
  }
  // what the day added up to (income minus spending, in the display currency at that day's rate)
  const dayNet = (items: Transaction[]) => items.reduce((a, t) => (isIncome(t) ? a.plus(toDisplayAt(t.amount, t.currency, t.date)) : isExpense(t) ? a.minus(toDisplayAt(t.amount, t.currency, t.date)) : a), d(0))

  const accountName = (subId: string) => {
    const s = subMap.get(subId)
    const a = s ? accMap.get(s.account_id) : undefined
    return a ? `${a.name}${s && s.name ? ' · ' + s.name : ''}` : '—'
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([day, items]) => (
        <section key={day}>
          {grouped ? (
            <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{dayLabel(day)}</h3>
              {(() => {
                const net = dayNet(items)
                return net.isZero() ? null : <Amount value={net} currency={display} colored showSign compact size="sm" className="text-xs font-medium" />
              })()}
            </div>
          ) : null}
          <Card className="overflow-hidden">
            {items.map((t, i) => {
              const cat = t.category_id ? cats.get(t.category_id) : undefined
              const isTransfer = t.type === 'transfer'
              const Icon = isTransfer ? ArrowLeftRight : iconFor(cat?.icon)
              const color = isTransfer ? '#64748b' : cat?.color ?? '#94a3b8'
              const catName = categoryName(t.category_id)
              const title = t.payee || t.notes || catName || (isTransfer ? 'Transfer' : t.type === 'income' ? 'Income' : 'Expense')
              const subtitle = isTransfer
                ? `${accountName(t.sub_account_id)} → ${t.to_sub_account_id ? accountName(t.to_sub_account_id) : '?'}`
                : [catName, accountName(t.sub_account_id)].filter(Boolean).join(' · ')
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
