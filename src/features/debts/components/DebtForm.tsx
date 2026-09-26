import { useEffect, useMemo, useState } from 'react'
import { AmountInput, Button, Field, Input, Segmented, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useAccounts, useContacts, useSubAccounts } from '@/api/queries'
import { useUpsert, useSaveTransaction } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { newId } from '@/utils/ids'
import { byId } from '@/utils'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { RECURRENCE_LABELS } from '@/domain/recurring'
import type { Debt, DebtDirection, Recurrence } from '@/api/database.types'

export function DebtForm({ open, onClose, direction, initial }: { open: boolean; onClose: () => void; direction: DebtDirection; initial?: Debt | null }) {
  const { data: contacts } = useContacts()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const currencies = useActiveCurrencies()
  const prefs = usePrefs()
  const upsertContact = useUpsert('contacts', { silent: true })
  const upsertDebt = useUpsert('debts', { invalidate: ['debt_payments'] })
  const saveTx = useSaveTransaction()

  const [dir, setDir] = useState<DebtDirection>(direction)
  const [contactId, setContactId] = useState('')
  const [newContact, setNewContact] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('EGP')
  const [date, setDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [plan, setPlan] = useState(false)
  const [planCount, setPlanCount] = useState('')
  const [planAmount, setPlanAmount] = useState('')
  const [planFreq, setPlanFreq] = useState<Recurrence>('monthly')
  const [planStart, setPlanStart] = useState('')
  const [moveMoney, setMoveMoney] = useState(false)
  const [subId, setSubId] = useState('')

  useEffect(() => {
    if (!open) return
    setDir(initial?.direction ?? direction)
    setContactId(initial?.contact_id ?? contacts?.[0]?.id ?? '')
    setNewContact('')
    setAmount(initial ? String(initial.amount) : '')
    setCurrency(initial?.currency ?? prefs.lastCurrency ?? currencies[0]?.code ?? 'EGP')
    setDate(initial?.date ?? todayIso())
    setDueDate(initial?.due_date ?? '')
    setReason(initial?.reason ?? '')
    setNotes(initial?.notes ?? '')
    setPlan(Boolean(initial?.plan_count))
    setPlanCount(initial?.plan_count ? String(initial.plan_count) : '')
    setPlanAmount(initial?.plan_amount ? String(initial.plan_amount) : '')
    setPlanFreq(initial?.plan_frequency ?? 'monthly')
    setPlanStart(initial?.plan_start_date ?? '')
    setMoveMoney(false)
    setSubId(prefs.lastSubAccountId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, direction])

  const subsForCurrency = (subs ?? []).filter((s) => !s.is_archived && s.currency === currency)
  const valid = d(amount).gt(0) && (contactId || newContact.trim()) && (!plan || parseInt(planCount) >= 1)

  const save = async () => {
    if (!valid) return
    let cid = contactId
    if (newContact.trim()) {
      cid = newId()
      await upsertContact.mutateAsync([{ id: cid, name: newContact.trim() }])
    }
    const id = initial?.id ?? newId()
    let txId: string | null = initial?.transaction_id ?? null
    if (!initial && moveMoney && subId) {
      txId = newId()
      await saveTx.mutateAsync({
        row: {
          id: txId,
          type: dir === 'i_owe' ? 'income' : 'expense',
          date,
          amount: toDb(amount),
          currency,
          sub_account_id: subId,
          category_id: null,
          tags: [],
          notes: `${dir === 'i_owe' ? 'Borrowed from' : 'Lent to'} ${newContact.trim() || (contacts?.find((c) => c.id === cid)?.name ?? '')}`,
          source: 'debt',
          source_id: id,
        },
      })
    }
    await upsertDebt.mutateAsync([
      {
        id,
        contact_id: cid,
        direction: dir,
        amount: toDb(amount),
        currency,
        date,
        due_date: dueDate || null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
        plan_count: plan ? parseInt(planCount) || null : null,
        plan_amount: plan && planAmount ? toDb(planAmount) : null,
        plan_frequency: plan ? planFreq : null,
        plan_start_date: plan ? planStart || date : null,
        sub_account_id: moveMoney ? subId || null : initial?.sub_account_id ?? null,
        transaction_id: txId,
        status: initial?.status ?? 'open',
      },
    ])
    prefs.remember({ lastCurrency: currency })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit debt' : dir === 'i_owe' ? 'Money I owe' : 'Money owed to me'}
      footer={
        <Button full size="lg" onClick={save} loading={upsertDebt.isPending || saveTx.isPending} disabled={!valid}>
          Save
        </Button>
      }
    >
      <div className="space-y-5">
        {!initial ? (
          <Segmented<DebtDirection>
            value={dir}
            onChange={setDir}
            options={[
              { value: 'owed_to_me', label: 'Owed to me' },
              { value: 'i_owe', label: 'I owe' },
            ]}
          />
        ) : null}
        <Field label="Person">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">New person…</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {!contactId ? (
          <Field label="Name">
            <Input value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Who?" />
          </Field>
        ) : null}
        <AmountInput value={amount} onChange={setAmount} currency={currency} currencies={currencies} onCurrencyChange={setCurrency} />
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Car repair" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Toggle checked={plan} onChange={setPlan} label="Installment plan" description="e.g. 5 × 2,000 monthly" />
        {plan ? (
          <div className="grid grid-cols-1 gap-4 rounded-2xl bg-surface-2 p-4 min-[360px]:grid-cols-2">
            <Field label="Installments">
              <Input inputMode="numeric" value={planCount} onChange={(e) => setPlanCount(e.target.value)} placeholder="5" />
            </Field>
            <Field label="Each" hint="Blank = split evenly">
              <Input inputMode="decimal" className="tnum" value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} placeholder="2000" />
            </Field>
            <Field label="Every">
              <Select value={planFreq} onChange={(e) => setPlanFreq(e.target.value as Recurrence)}>
                {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((f) => (
                  <option key={f} value={f}>
                    {RECURRENCE_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="First due">
              <Input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {!initial ? (
          <>
            <Toggle checked={moveMoney} onChange={setMoveMoney} label={dir === 'i_owe' ? 'Money came into an account' : 'Money left an account'} description="Records the matching transaction" />
            {moveMoney ? (
              <Field label="Account">
                <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
                  <option value="">Choose…</option>
                  {subsForCurrency.map((s) => (
                    <option key={s.id} value={s.id}>
                      {accMap.get(s.account_id)?.name} · {s.currency}
                      {s.name ? ' · ' + s.name : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
