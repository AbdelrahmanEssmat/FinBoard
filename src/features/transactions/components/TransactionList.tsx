import { useMemo } from 'react'
import { ArrowLeftRight, HandCoins, Inbox } from 'lucide-react'
import { Amount, EmptyState, ListRow } from '@/components/shared'
import { Card, Divider } from '@/components/ui'
import { useAccounts, useCategories, useDebts, useInstallmentPlans, useSubAccounts } from '@/api/queries'
import { useHistoricalConvert } from '@/hooks/useMoney'
import { accountDisplayName } from '@/features/accounts/accountLabels'
import { isExpense, isIncome } from '@/domain/insights'
import { d } from '@/domain/money'
import { byId, groupBy } from '@/utils'
import { iconFor } from '@/utils/icons'
import { formatDate, todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'
import type { Transaction } from '@/api/database.types'
import { debtKind } from '@/domain/debts'

export function TransactionList({
  transactions,
  onSelect,
  emptyText,
  grouped = true,
}: {
  transactions: Transaction[]
  onSelect?: (t: Transaction) => void
  emptyText?: string
  grouped?: boolean
}) {
  const { data: categories } = useCategories()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const cats = useMemo(() => byId(categories), [categories])
  const subMap = useMemo(() => byId(subs), [subs])
  const accMap = useMemo(() => byId(accounts), [accounts])
  const { toDisplayAt, display } = useHistoricalConvert()
  const { data: plans } = useInstallmentPlans()
  // purchases paid in installments: "12× installments" in the row
  const planByTx = useMemo(() => new Map((plans ?? []).filter((p) => p.transaction_id).map((p) => [p.transaction_id!, p])), [plans])
  // money lent, borrowed or repaid: marked as a debt (it isn't income or spending)
  const { data: debts } = useDebts()
  const debtMap = useMemo(() => byId(debts), [debts])

  if (!transactions.length)
    return <EmptyState icon={Inbox} title="Nothing here yet" description={emptyText ?? 'Add an expense, income or transfer with the + button.'} />

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
  const dayNet = (items: Transaction[]) =>
    items.reduce(
      (a, t) => (isIncome(t) ? a.plus(toDisplayAt(t.amount, t.currency, t.date)) : isExpense(t) ? a.minus(toDisplayAt(t.amount, t.currency, t.date)) : a),
      d(0),
    )

  const accountName = (subId: string) => {
    const s = subMap.get(subId)
    const a = s ? accMap.get(s.account_id) : undefined
    return a ? `${accountDisplayName(a, accMap)}${s && s.name ? ' · ' + s.name : ''}` : '—'
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([day, items]) => (
        <section key={day}>
          {grouped ? (
            <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-muted text-xs font-semibold tracking-[0.06em] uppercase">{dayLabel(day)}</h3>
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
              const isDebt = t.source === 'debt'
              const Icon = isTransfer ? ArrowLeftRight : isDebt ? HandCoins : iconFor(cat?.icon)
              const color = isTransfer ? '#64748b' : isDebt ? '#f97316' : (cat?.color ?? '#94a3b8')
              const catName = categoryName(t.category_id)
              const title = t.payee || t.notes || catName || (isTransfer ? 'Transfer' : isDebt ? 'Debt' : t.type === 'income' ? 'Income' : 'Expense')
              const subtitle = isTransfer
                ? `${accountName(t.sub_account_id)} → ${t.to_sub_account_id ? accountName(t.to_sub_account_id) : '?'}`
                : [isDebt ? debtKind(t, t.source_id ? debtMap.get(t.source_id) : undefined) : catName, accountName(t.sub_account_id), planByTx.get(t.id) ? `${planByTx.get(t.id)!.months}× installments` : null]
                    .filter(Boolean)
                    .join(' · ')
              return (
                <div key={t.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    icon={Icon}
                    color={color}
                    title={
                      isDebt ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{title}</span>
                          <span className="bg-warning-soft text-warning shrink-0 rounded-full px-2 py-px text-[11px] leading-4 font-semibold">Debt</span>
                        </span>
                      ) : (
                        title
                      )
                    }
                    subtitle={subtitle}
                    onClick={onSelect ? () => onSelect(t) : undefined}
                    trailing={
                      isTransfer ? (
                        <span className="flex flex-col items-end">
                          <Amount value={t.amount} currency={t.currency} className="text-sm font-medium" />
                          {t.to_currency && t.to_currency !== t.currency ? (
                            <Amount value={t.to_amount ?? 0} currency={t.to_currency} size="sm" className="text-muted" />
                          ) : null}
                        </span>
                      ) : (
                        // a debt's money only moved between you and someone: signed, but not coloured as income or spending
                        <Amount value={t.type === 'expense' ? -t.amount : t.amount} currency={t.currency} colored={!isDebt} showSign className="font-semibold" />
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
