import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AmountInput, Button, ConfirmDialog, Field, Input, Segmented, Select, Sheet, Toggle } from '@/components/ui'
import { useAccounts, useSubAccounts } from '@/lib/data/tables'
import { useUndoableDelete, useUpsert } from '@/lib/data/mutations'
import { useActiveCurrencies } from '@/lib/data/derived'
import { newId } from '@/lib/ids'
import { byId } from '@/lib/utils'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { RECURRENCE_LABELS } from '@/domain/recurring'
import { CategoryPicker } from '@/features/categories/CategoryPicker'
import type { Recurrence, RecurringTransaction, TransactionType } from '@/lib/database.types'

export function RecurringForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: RecurringTransaction | null }) {
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const activeSubs = useMemo(() => (subs ?? []).filter((s) => !s.is_archived), [subs])
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('recurring_transactions')
  const remove = useUndoableDelete('recurring_transactions', { label: 'Recurring item' })

  const [name, setName] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [subId, setSubId] = useState('')
  const [toSubId, setToSubId] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [frequency, setFrequency] = useState<Recurrence>('monthly')
  const [interval, setInterval] = useState('1')
  const [nextDate, setNextDate] = useState(todayIso())
  const [endDate, setEndDate] = useState('')
  const [autoPost, setAutoPost] = useState(true)
  const [active, setActive] = useState(true)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setType(initial?.type ?? 'expense')
    setAmount(initial ? String(initial.amount) : '')
    setSubId(initial?.sub_account_id ?? activeSubs[0]?.id ?? '')
    setToSubId(initial?.to_sub_account_id ?? '')
    setToAmount(initial?.to_amount != null ? String(initial.to_amount) : '')
    setCategoryId(initial?.category_id ?? null)
    setFrequency(initial?.frequency ?? 'monthly')
    setInterval(String(initial?.interval_count ?? 1))
    setNextDate(initial?.next_date ?? todayIso())
    setEndDate(initial?.end_date ?? '')
    setAutoPost(initial?.auto_post ?? true)
    setActive(initial?.is_active ?? true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const sub = activeSubs.find((s) => s.id === subId)
  const toSub = activeSubs.find((s) => s.id === toSubId)
  const currency = sub?.currency ?? 'EGP'
  const cross = type === 'transfer' && toSub && toSub.currency !== currency
  const valid = name.trim() && d(amount).gt(0) && subId && (type !== 'transfer' || (toSubId && toSubId !== subId))
  const label = (s: (typeof activeSubs)[number]) => `${accMap.get(s.account_id)?.name ?? ''} · ${s.currency}${s.name ? ' · ' + s.name : ''}`

  const save = async () => {
    if (!valid) return
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        name: name.trim(),
        type,
        amount: toDb(amount),
        currency,
        sub_account_id: subId,
        category_id: type === 'transfer' ? null : categoryId,
        to_sub_account_id: type === 'transfer' ? toSubId : null,
        to_amount: type === 'transfer' ? toDb(cross ? toAmount || amount : amount) : null,
        to_currency: type === 'transfer' ? toSub?.currency ?? currency : null,
        frequency,
        interval_count: Math.max(1, parseInt(interval) || 1),
        next_date: nextDate,
        end_date: endDate || null,
        auto_post: autoPost,
        is_active: active,
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit recurring' : 'New recurring'}
      footer={
        <div className="flex gap-2">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Segmented value={type} onChange={setType} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }]} />
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary, Rent, Netflix" />
        </Field>
        <AmountInput value={amount} onChange={setAmount} currency={currency} currencies={currencies} />
        <Field label={type === 'transfer' ? 'From' : 'Account'}>
          <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
            {activeSubs.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
        {type === 'transfer' ? (
          <>
            <Field label="To">
              <Select value={toSubId} onChange={(e) => setToSubId(e.target.value)}>
                <option value="">Choose…</option>
                {activeSubs.filter((s) => s.id !== subId).map((s) => (
                  <option key={s.id} value={s.id}>
                    {label(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {cross ? (
              <Field label={`Amount received (${toSub?.currency})`}>
                <AmountInput value={toAmount} onChange={setToAmount} currency={toSub?.currency ?? ''} currencies={currencies} />
              </Field>
            ) : null}
          </>
        ) : (
          <Field label="Category">
            <CategoryPicker kind={type} value={categoryId} onChange={setCategoryId} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Recurrence)}>
              {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((f) => (
                <option key={f} value={f}>
                  {RECURRENCE_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Every">
            <Input inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
          </Field>
          <Field label="Next date">
            <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Toggle checked={autoPost} onChange={setAutoPost} label="Post automatically" description="Off = only remind me on the dashboard" />
        {initial ? <Toggle checked={active} onChange={setActive} label="Active" /> : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this recurring item?"
        message="Already-posted transactions are kept."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
