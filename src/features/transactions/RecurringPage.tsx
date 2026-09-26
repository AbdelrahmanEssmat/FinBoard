import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Repeat } from 'lucide-react'
import { Amount, Button, Card, Divider, EmptyState, ListRow, PageHeader, Pill } from '@/components/ui'
import { useAccounts, useCategories, useRecurring, useSubAccounts } from '@/lib/data/tables'
import { byId } from '@/lib/utils'
import { iconFor } from '@/lib/icons'
import { formatDate } from '@/domain/format'
import { RECURRENCE_LABELS } from '@/domain/recurring'
import { RecurringForm } from './RecurringForm'
import type { RecurringTransaction } from '@/lib/database.types'

export default function RecurringPage() {
  const navigate = useNavigate()
  const { data } = useRecurring()
  const { data: categories } = useCategories()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const cats = useMemo(() => byId(categories), [categories])
  const subMap = useMemo(() => byId(subs), [subs])
  const accMap = useMemo(() => byId(accounts), [accounts])
  const [form, setForm] = useState<{ open: boolean; item?: RecurringTransaction | null }>({ open: false })

  const active = (data ?? []).filter((r) => r.is_active)
  const paused = (data ?? []).filter((r) => !r.is_active)

  const row = (r: RecurringTransaction) => {
    const cat = r.category_id ? cats.get(r.category_id) : undefined
    const sub = subMap.get(r.sub_account_id)
    const acc = sub ? accMap.get(sub.account_id) : undefined
    const every = r.interval_count > 1 ? `Every ${r.interval_count} ${r.frequency === 'daily' ? 'days' : r.frequency === 'weekly' ? 'weeks' : r.frequency === 'monthly' ? 'months' : 'years'}` : RECURRENCE_LABELS[r.frequency]
    return (
      <ListRow
        key={r.id}
        icon={r.type === 'transfer' ? Repeat : iconFor(cat?.icon)}
        color={cat?.color ?? '#64748b'}
        title={r.name}
        subtitle={`${every} · next ${formatDate(r.next_date)} · ${acc?.name ?? ''}`}
        trailing={
          <span className="flex flex-col items-end gap-1">
            <Amount value={r.type === 'expense' ? -r.amount : r.amount} currency={r.currency} colored={r.type !== 'transfer'} showSign className="font-semibold" />
            {!r.auto_post ? <Pill>reminder only</Pill> : null}
          </span>
        }
        onClick={() => setForm({ open: true, item: r })}
      />
    )
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Recurring"
        subtitle="Salary, rent, subscriptions"
        action={
          <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      {!data?.length ? (
        <EmptyState icon={Repeat} title="No recurring items" description="Add your salary, rent or subscriptions and they will be posted automatically on their due date." action={<Button onClick={() => setForm({ open: true, item: null })}>Add recurring</Button>} />
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            {active.map((r, i) => (
              <div key={r.id}>
                {i > 0 ? <Divider /> : null}
                {row(r)}
              </div>
            ))}
            {!active.length ? <p className="p-4 text-sm text-muted">Nothing active.</p> : null}
          </Card>
          {paused.length ? (
            <div>
              <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Paused / ended</h2>
              <Card className="overflow-hidden opacity-70">
                {paused.map((r, i) => (
                  <div key={r.id}>
                    {i > 0 ? <Divider /> : null}
                    {row(r)}
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
        </div>
      )}
      <RecurringForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
    </div>
  )
}
