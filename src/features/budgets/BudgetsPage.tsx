import { useEffect, useState } from 'react'
import { PieChart, Plus, Trash2 } from 'lucide-react'
import { Amount, EmptyState, PageHeader, PageSkeleton } from '@/components/shared'
import { Button, Card, ConfirmDialog, Field, Input, ProgressBar, Select, Sheet } from '@/components/ui'
import { useBudgets, useCategories } from '@/api/queries'
import { useBudgetUsage } from '@/features/budgets/useBudgetUsage'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { useActiveCurrencies, useConvert } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { endOfMonthIso } from '@/utils'
import { d, toDb } from '@/domain/money'
import { iconFor } from '@/utils/icons'
import type { Budget } from '@/api/database.types'
import { DEFAULT_CURRENCY } from '@/domain/currency'

export default function BudgetsPage() {
  const { rows, budgets, isLoading } = useBudgetUsage()
  const { toDisplayOrZero, display } = useConvert()
  const [form, setForm] = useState<{ open: boolean; item?: Budget | null }>({ open: false })
  const totalBudget = rows.reduce((a, r) => a.plus(toDisplayOrZero(r.b.amount, r.b.currency)), d(0))
  const totalSpent = rows.reduce((a, r) => a.plus(toDisplayOrZero(r.spent, r.b.currency)), d(0))
  // days left in the month, counting today
  const daysLeft = Math.max(1, new Date(endOfMonthIso() + 'T00:00:00').getDate() - new Date().getDate() + 1)

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Budgets"
        subtitle={`${new Date().toLocaleDateString('en-GB', { month: 'long' })} · ${daysLeft} days left`}
        action={
          <Button size="sm" variant="soft" onClick={() => setForm({ open: true, item: null })}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      {isLoading && !budgets ? (
        <PageSkeleton />
      ) : !budgets?.length ? (
        <EmptyState icon={PieChart} title="No budgets yet" description="Set a monthly limit per category and watch progress through the month." action={<Button onClick={() => setForm({ open: true, item: null })}>Add budget</Button>} />
      ) : (
        <div className="space-y-5">
          <Card padded>
            <div className="flex items-end justify-between">
              <div className="min-w-0">
                <div className="text-xs text-muted">Spent this month</div>
                <Amount value={totalSpent} currency={display} size="lg" />
              </div>
              <div className="text-right text-xs text-muted">
                of <Amount value={totalBudget} currency={display} size="sm" />
              </div>
            </div>
            <ProgressBar className="mt-3" value={totalBudget.isZero() ? 0 : totalSpent.div(totalBudget).times(100).toNumber()} color={totalSpent.gt(totalBudget) ? 'var(--color-negative)' : undefined} />
          </Card>
          <div className="space-y-3">
            {rows.map(({ b, cat, spent, pct, left }) => {
              const Icon = iconFor(cat?.icon)
              const over = pct > 100
              return (
                <Card key={b.id} className="p-4">
                  <button onClick={() => setForm({ open: true, item: b })} className="flex w-full items-center gap-3 text-left">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: (cat?.color ?? '#64748b') + '22', color: cat?.color ?? '#64748b' }}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between">
                        <span className="truncate font-medium">{cat?.name ?? 'Category'}</span>
                        <Amount value={spent} currency={b.currency} className={`text-sm font-semibold ${over ? 'text-negative' : ''}`} />
                      </span>
                      <span className="flex items-center justify-between text-xs text-muted">
                        <span>{over ? 'Over by ' : 'Left '}<Amount value={left.abs()} currency={b.currency} size="sm" /></span>
                        <span>of <Amount value={b.amount} currency={b.currency} size="sm" /></span>
                      </span>
                    </span>
                  </button>
                  <ProgressBar className="mt-3" value={pct} color={over ? 'var(--color-negative)' : pct > 80 ? 'var(--color-warning)' : cat?.color} />
                </Card>
              )
            })}
          </div>
        </div>
      )}
      <BudgetForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
    </div>
  )
}

function BudgetForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Budget | null }) {
  const { data: categories } = useCategories()
  const { data: budgets } = useBudgets()
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('budgets')
  const remove = useUndoableDelete('budgets', { label: 'Budget' })
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [confirm, setConfirm] = useState(false)
  const available = (categories ?? []).filter((c) => c.kind === 'expense' && !c.parent_id && !c.is_archived && (c.id === initial?.category_id || !budgets?.some((b) => b.category_id === c.id)))

  useEffect(() => {
    if (!open) return
    setCategoryId(initial?.category_id ?? available[0]?.id ?? '')
    setAmount(initial ? String(initial.amount) : '')
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id])

  const save = async () => {
    if (!categoryId || !d(amount).gt(0)) return
    await upsert.mutateAsync([{ id: initial?.id ?? newId(), category_id: categoryId, amount: toDb(amount), currency }])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit budget' : 'New budget'}
      footer={
        <div className="flex gap-3">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!categoryId || !d(amount).gt(0)}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {!initial && !available.length ? (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">Every expense category already has a budget. Tap one on the Budgets page to change it.</p>
        ) : (
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={Boolean(initial)}>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Monthly limit">
            <Input inputMode="decimal" className="tnum" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24">
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Delete this budget?" onConfirm={() => { if (initial) remove(initial); onClose() }} />
    </Sheet>
  )
}
