import { Card, Divider } from '@/components/ui'
import { Amount, ListRow, Section } from '@/components/shared'
import { formatDate } from '@/domain/format'
import { iconFor } from '@/utils/icons'
import type { PayeeTotal, TxLike } from '@/domain/insights'
import type { Decimal } from '@/domain/money'
import type { CategoryLike } from '@/domain/insights'

export function TopPayeesCard({ payees, display }: { payees: PayeeTotal[]; display: string }) {
  if (!payees.length) return null
  const max = payees[0]!.value
  return (
    <Section title="Where the money goes">
      <Card className="overflow-hidden">
        {payees.map((p, i) => (
          <div key={p.name}>
            {i > 0 ? <Divider /> : null}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[15px] font-medium">{p.name}</span>
                <Amount value={p.value} currency={display} className="text-sm font-semibold" />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${max.isZero() ? 0 : p.value.div(max).times(100).toNumber()}%` }} />
                </div>
                <span className="text-[11px] text-muted">{p.count}×</span>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </Section>
  )
}

export function LargestTransactionsCard({ items, display, categories }: { items: (TxLike & { base: Decimal })[]; display: string; categories: Map<string, CategoryLike> }) {
  if (!items.length) return null
  return (
    <Section title="Largest expenses">
      <Card className="overflow-hidden">
        {items.map((t, i) => {
          const cat = t.category_id ? categories.get(t.category_id) : undefined
          return (
            <div key={t.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow icon={iconFor(cat?.icon)} color={cat?.color} title={t.payee || t.notes || cat?.name || 'Expense'} subtitle={`${formatDate(t.date)}${cat ? ' · ' + cat.name : ''}`} trailing={<Amount value={t.base} currency={display} className="font-semibold" />} />
            </div>
          )
        })}
      </Card>
    </Section>
  )
}
