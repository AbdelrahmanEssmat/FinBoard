import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AmountInput, Button, ConfirmDialog, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { useAccounts, useCategories, useSubAccounts } from '@/api/queries'
import { useSaveTransaction, useUndoableDeleteTransaction } from '@/api/mutations'
import { useConvert, useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { newId } from '@/utils/ids'
import { byId } from '@/utils'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import type { Transaction, TransactionType } from '@/api/database.types'
import { CategoryPicker } from '@/features/categories/components/CategoryPicker'

export function TransactionForm({ open, onClose, initial, defaultType = 'expense', onSaved }: { open: boolean; onClose: () => void; initial?: Transaction | null; defaultType?: TransactionType; onSaved?: () => void }) {
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories()
  const currencies = useActiveCurrencies()
  const { between } = useConvert()
  const prefs = usePrefs()
  const save = useSaveTransaction()
  const remove = useUndoableDeleteTransaction()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const activeSubs = useMemo(() => (subs ?? []).filter((s) => !s.is_archived && !accMap.get(s.account_id)?.is_archived), [subs, accMap])

  const [type, setType] = useState<TransactionType>(defaultType)
  const [amount, setAmount] = useState('')
  const [subId, setSubId] = useState('')
  const [toSubId, setToSubId] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [payee, setPayee] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [confirm, setConfirm] = useState(false)

  const sub = activeSubs.find((s) => s.id === subId) ?? subs?.find((s) => s.id === subId)
  const toSub = activeSubs.find((s) => s.id === toSubId)
  const currency = sub?.currency ?? prefs.lastCurrency ?? 'EGP'
  const toCurrency = toSub?.currency ?? currency
  const crossCurrency = type === 'transfer' && toCurrency !== currency

  useEffect(() => {
    if (!open) return
    if (initial) {
      setType(initial.type)
      setAmount(String(initial.amount))
      setSubId(initial.sub_account_id)
      setToSubId(initial.to_sub_account_id ?? '')
      setToAmount(initial.to_amount != null ? String(initial.to_amount) : '')
      setCategoryId(initial.category_id)
      setDate(initial.date)
      setPayee(initial.payee ?? '')
      setNotes(initial.notes ?? '')
      setTags(initial.tags.join(', '))
    } else {
      setType(defaultType)
      setAmount('')
      const preferred = activeSubs.find((s) => s.id === prefs.lastSubAccountId) ?? activeSubs[0]
      setSubId(preferred?.id ?? '')
      setToSubId(activeSubs.find((s) => s.id !== preferred?.id)?.id ?? '')
      setToAmount('')
      setCategoryId(defaultType === 'income' ? prefs.lastIncomeCategoryId : prefs.lastExpenseCategoryId)
      setDate(todayIso())
      setPayee('')
      setNotes('')
      setTags('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultType])

  // suggest converted amount for cross-currency transfers
  useEffect(() => {
    if (!crossCurrency || !open) return
    const conv = between(amount || 0, currency, toCurrency)
    if (conv && (!initial || initial.to_amount == null)) setToAmount(conv.toDecimalPlaces(2).toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, currency, toCurrency, crossCurrency, open])

  // keep category kind in sync with type
  useEffect(() => {
    if (type === 'transfer') return
    const cat = categories?.find((c) => c.id === categoryId)
    if (cat && cat.kind !== type) setCategoryId(type === 'income' ? prefs.lastIncomeCategoryId : prefs.lastExpenseCategoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const valid = d(amount).gt(0) && subId && (type !== 'transfer' || (toSubId && toSubId !== subId && (!crossCurrency || d(toAmount).gt(0))))

  const submit = async () => {
    if (!valid) return
    const id = initial?.id ?? newId()
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
    const rateUsed = crossCurrency && d(amount).gt(0) ? d(toAmount).div(d(amount)).toFixed(8) : null
    const row = {
      id,
      type,
      date,
      amount: toDb(amount),
      currency,
      sub_account_id: subId,
      category_id: type === 'transfer' ? null : categoryId,
      tags: tagList,
      notes: notes.trim() || null,
      payee: payee.trim() || null,
      to_sub_account_id: type === 'transfer' ? toSubId : null,
      to_amount: type === 'transfer' ? toDb(crossCurrency ? toAmount : amount) : null,
      to_currency: type === 'transfer' ? toCurrency : null,
      rate_used: rateUsed,
      source: initial?.source ?? 'manual',
      source_id: initial?.source_id ?? null,
    }
    prefs.remember({ lastSubAccountId: subId, lastCurrency: currency, ...(type === 'expense' ? { lastExpenseCategoryId: categoryId } : type === 'income' ? { lastIncomeCategoryId: categoryId } : {}) })
    await save.mutateAsync({ row, previous: initial ?? null })
    onSaved?.()
    onClose()
  }

  const subLabel = (s: (typeof activeSubs)[number]) => `${accMap.get(s.account_id)?.name ?? 'Account'} · ${s.currency}${s.name ? ' · ' + s.name : ''}`

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit transaction' : type === 'income' ? 'Add income' : type === 'transfer' ? 'Transfer' : 'Add expense'}
      footer={
        <div className="flex gap-2">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={submit} loading={save.isPending} disabled={!valid}>
            {initial ? 'Save changes' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {!initial?.source || initial.source === 'manual' ? (
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        ) : (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Created automatically from a {initial.source === 'debt' ? 'debt payment' : initial.source === 'certificate' ? 'certificate payout' : 'recurring rule'}.</p>
        )}

        <AmountInput autoFocus={!initial} value={amount} onChange={setAmount} currency={currency} currencies={currencies} />

        <Field label={type === 'transfer' ? 'From' : 'Account'}>
          <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
            {!activeSubs.length ? <option value="">No accounts yet</option> : null}
            {activeSubs.map((s) => (
              <option key={s.id} value={s.id}>
                {subLabel(s)}
              </option>
            ))}
          </Select>
        </Field>

        {type === 'transfer' ? (
          <>
            <Field label="To">
              <Select value={toSubId} onChange={(e) => setToSubId(e.target.value)}>
                {activeSubs.filter((s) => s.id !== subId).map((s) => (
                  <option key={s.id} value={s.id}>
                    {subLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {crossCurrency ? (
              <Field label={`Amount received (${toCurrency})`} hint={d(amount).gt(0) && d(toAmount).gt(0) ? `Rate used: 1 ${currency} = ${d(toAmount).div(d(amount)).toFixed(4)} ${toCurrency}` : 'Suggested from today’s rate; edit to match what the bank gave you'}>
                <AmountInput value={toAmount} onChange={setToAmount} currency={toCurrency} currencies={currencies} />
              </Field>
            ) : null}
          </>
        ) : (
          <Field label="Category">
            <CategoryPicker kind={type} value={categoryId} onChange={setCategoryId} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={type === 'income' ? 'From' : 'Paid to'}>
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Tags" hint="Comma separated">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. travel, work" />
        </Field>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this transaction?"
        message="The account balance will be adjusted. You can undo for a few seconds."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
