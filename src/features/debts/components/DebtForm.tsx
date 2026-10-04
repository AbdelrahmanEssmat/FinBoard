import { useEffect, useRef, useState } from 'react'
import { AmountInput, Button, Field, Input, Segmented, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useContacts, useDebtPayments, useSubAccounts } from '@/api/queries'
import { useCreateDebt, useRpc, useSetDebtAccount, useUpdateRows, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { format, isValid, parseISO } from 'date-fns'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
import { formatDate, todayIso } from '@/domain/format'
import { addPeriod } from '@/domain/installments'
import { RECURRENCE_LABELS } from '@/domain/recurring'
import type { Debt, DebtDirection, Recurrence } from '@/api/database.types'
import { DEFAULT_CURRENCY } from '@/domain/currency'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'

export function DebtForm({ open, onClose, direction, initial }: { open: boolean; onClose: () => void; direction: DebtDirection; initial?: Debt | null }) {
  const { data: contacts } = useContacts()
  const { data: subs } = useSubAccounts()
  const { data: payments } = useDebtPayments()
  const currencies = useActiveCurrencies()
  const prefs = usePrefs()
  const upsertContact = useUpsert('contacts', { silent: true })
  const updateDebt = useUpdateRows('debts', { invalidate: ['debt_payments'] })
  // fixed per opening, so tapping Save again after a failed step updates the same rows instead of
  // creating a second contact, a second money movement or a second debt
  const ids = useRef({ contact: '', debt: '', tx: '', rule: '' })
  const createDebt = useCreateDebt()
  const setDebtAccount = useSetDebtAccount()
  // a monthly debt: the rule, then whatever is already due is added at once (the daily jobs add the rest)
  const upsertRule = useUpsert('recurring_debts', { silent: true })
  const postDue = useRpc('post_due_recurring_debts', ['debts', 'transactions', 'sub_accounts', 'recurring_debts'])

  const [dir, setDir] = useState<DebtDirection>(direction)
  const [contactId, setContactId] = useState('')
  const [newContact, setNewContact] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
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
  const [repeat, setRepeat] = useState(false)
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    if (!open) return
    ids.current = { contact: newId(), debt: newId(), tx: newId(), rule: newId() }
    setRepeat(false)
    setEndDate('')
    setDir(initial?.direction ?? direction)
    setContactId(initial?.contact_id ?? contacts?.[0]?.id ?? '')
    setNewContact('')
    setAmount(initial ? String(initial.amount) : '')
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setDate(initial?.date ?? todayIso())
    setDueDate(initial?.due_date ?? '')
    setReason(initial?.reason ?? '')
    setNotes(initial?.notes ?? '')
    setPlan(Boolean(initial?.plan_count))
    setPlanCount(initial?.plan_count ? String(initial.plan_count) : '')
    setPlanAmount(initial?.plan_amount ? String(initial.plan_amount) : '')
    setPlanFreq(initial?.plan_frequency ?? 'monthly')
    setPlanStart(initial?.plan_start_date ?? '')
    // a debt is a record: no account changes until it is repaid, unless the money is said to have moved
    // when it was lent or borrowed; an edited debt starts as it was saved
    setMoveMoney(initial ? Boolean(initial.transaction_id) : false)
    setSubId(initial?.transaction_id ? (initial.sub_account_id ?? '') : (prefs.lastSubAccountId ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, direction])

  // (the balance a saved debt's money moved in stays on the list even if it was archived since)
  const subsForCurrency = (subs ?? []).filter((s) => s.currency === currency && (!s.is_archived || (Boolean(initial?.transaction_id) && s.id === initial?.sub_account_id)))
  // keep the chosen balance in the debt's currency whenever the currency or the balances change
  useEffect(() => {
    if (!open) return
    setSubId((cur) =>
      subsForCurrency.some((s) => s.id === cur) ? cur : (subsForCurrency.find((s) => s.id === prefs.lastSubAccountId)?.id ?? subsForCurrency[0]?.id ?? ''),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currency, subs])
  const effectiveSubId = subsForCurrency.some((s) => s.id === subId) ? subId : ''

  // once money has moved (a linked transaction or any repayment) the currency is fixed
  const paidSoFar = (payments ?? []).filter((p) => p.debt_id === initial?.id).reduce((a, p) => a.plus(d(p.amount)), d(0))
  const currencyLocked = Boolean(initial && (initial.transaction_id || paidSoFar.gt(0)))
  const belowPaid = Boolean(initial) && d(amount).lt(paidSoFar)
  // moving money needs an account to move it in or out of (with no balance in this currency, it's only recorded)
  const canMove = subsForCurrency.length > 0
  // a monthly debt always moves its money (in when you borrow, out when you lend) on each date
  const repeating = !initial && repeat
  const effectiveMove = (moveMoney || repeating) && canMove
  const endBeforeStart = repeating && Boolean(endDate) && endDate < date
  const accountMissing = effectiveMove && !effectiveSubId
  // an edited debt: is its money movement being added, moved to another balance or taken off?
  const linkedBefore = Boolean(initial?.transaction_id)
  const linkChanged = Boolean(initial) && (effectiveMove !== linkedBefore || (effectiveMove && effectiveSubId !== (initial?.sub_account_id ?? '')))
  const valid =
    d(amount).gt(0) && !belowPaid && (contactId || newContact.trim()) && (repeating || !plan || parseInt(planCount) >= 1) && !accountMissing && (!repeating || canMove) && !endBeforeStart
  // the first installment falls one period after the money changed hands, not the same day
  const parsedDate = parseISO(date)
  /** "5th": the day each monthly date falls on */
  const dayOfMonth = isValid(parsedDate) ? format(parsedDate, 'do') : 'same day'
  const defaultPlanStart = isValid(parsedDate) ? format(addPeriod(parsedDate, planFreq), 'yyyy-MM-dd') : date

  const save = async () => {
    if (!valid) return
    // a picked person wins over a name typed earlier under "New person…"
    const isNewPerson = !contactId && Boolean(newContact.trim())
    const cid = isNewPerson ? ids.current.contact : contactId
    const id = initial?.id ?? ids.current.debt
    const contactName = isNewPerson ? newContact.trim() : (contacts?.find((c) => c.id === cid)?.name ?? '')
    const plan_count = plan ? parseInt(planCount) || null : null
    const plan_amount = plan && planAmount ? toDb(planAmount) : null
    const plan_frequency = plan ? planFreq : null
    const plan_start_date = plan ? planStart || defaultPlanStart : null
    if (repeating) {
      if (isNewPerson) await upsertContact.mutateAsync([{ id: cid, name: newContact.trim() }])
      await upsertRule.mutateAsync([
        {
          id: ids.current.rule,
          contact_id: cid,
          direction: dir,
          amount: toDb(amount),
          currency,
          sub_account_id: effectiveSubId,
          start_date: date,
          next_date: date,
          end_date: endDate || null,
          reason: reason.trim() || null,
          is_active: true,
        },
      ])
      if (date <= todayIso()) await postDue.mutateAsync({})
      prefs.remember({ lastCurrency: currency, lastSubAccountId: effectiveSubId })
      onClose()
      return
    }
    if (initial) {
      if (isNewPerson) await upsertContact.mutateAsync([{ id: cid, name: newContact.trim() }])
      // only what this form edits: the linked money movement, its account and the direction are kept by
      // the database, and a stale copy of them must never be sent back
      await updateDebt.mutateAsync([
        {
          id,
          contact_id: cid,
          amount: toDb(amount),
          currency,
          date,
          due_date: dueDate || null,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
          plan_count,
          plan_amount,
          plan_frequency,
          plan_start_date,
        },
      ])
      // after the edit, so a new money movement takes the new amount, date and currency
      if (linkChanged) {
        await setDebtAccount.mutateAsync({
          debt: { id, direction: initial.direction, amount: toDb(amount), currency, date, transaction_id: initial.transaction_id, sub_account_id: initial.sub_account_id },
          linkedAmount: initial.amount,
          contactName,
          subAccountId: effectiveMove ? effectiveSubId : null,
          transactionId: ids.current.tx,
        })
      }
    } else {
      // the person, the money movement and the debt are saved together, or not at all
      await createDebt.mutateAsync({
        id,
        contactId: cid,
        newContactName: isNewPerson ? newContact.trim() : null,
        contactName,
        direction: dir,
        amount: toDb(amount),
        currency,
        date,
        dueDate: dueDate || null,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
        planCount: plan_count,
        planAmount: plan_amount,
        planFrequency: plan_frequency,
        planStartDate: plan_start_date,
        subAccountId: effectiveMove && effectiveSubId ? effectiveSubId : null,
        transactionId: ids.current.tx,
      })
    }
    prefs.remember({ lastCurrency: currency, ...(effectiveMove && effectiveSubId ? { lastSubAccountId: effectiveSubId } : {}) })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit debt' : dir === 'i_owe' ? 'Money I owe' : 'Money owed to me'}
      footer={
        <Button full size="lg" onClick={save} loading={createDebt.isPending || updateDebt.isPending || upsertContact.isPending || setDebtAccount.isPending || upsertRule.isPending || postDue.isPending} disabled={!valid}>
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
        <AmountInput
          value={amount}
          onChange={setAmount}
          currency={currency}
          currencies={currencies}
          onCurrencyChange={currencyLocked ? undefined : setCurrency}
        />
        {belowPaid ? (
          <p className="text-negative -mt-2 text-xs">
            <Amount value={paidSoFar} currency={currency} size="sm" /> has already been paid, so the amount can't be lower than that.
          </p>
        ) : null}
        {!initial ? (
          <Toggle
            checked={repeat}
            onChange={setRepeat}
            label="Repeats every month"
            description={
              repeat
                ? dir === 'i_owe'
                  ? `On the ${dayOfMonth} of every month the money comes into the account below and a new debt to repay is recorded.`
                  : `On the ${dayOfMonth} of every month the money leaves the account below and a new debt is recorded for them to repay.`
                : 'Adds this debt again every month, on the same day'
            }
          />
        ) : null}
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label={repeating ? 'First date' : 'Date'}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {repeating ? (
            <Field label="Last date" hint={endBeforeStart ? 'Before the first date' : 'Blank = until you stop it'}>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          ) : (
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Car repair" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {!repeating ? <Toggle checked={plan} onChange={setPlan} label="Installment plan" description="e.g. 5 × 2,000 monthly" /> : null}
        {plan && !repeating ? (
          <div className="bg-surface-2 grid grid-cols-1 gap-4 rounded-2xl p-4 min-[360px]:grid-cols-2">
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
            <Field label="First due" hint={planStart ? undefined : `Blank = ${formatDate(defaultPlanStart, 'd MMM yyyy')}`}>
              <Input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {repeating ? (
          canMove ? (
            <Field label={dir === 'i_owe' ? 'Comes into' : 'Leaves from'} hint={accountMissing ? 'Choose the account' : 'Not counted as income or spending'}>
              <Select value={effectiveSubId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">Choose…</option>
                <BalanceOptions subs={subsForCurrency} />
              </Select>
            </Field>
          ) : (
            <p className="text-negative text-xs">A monthly debt moves money each month: add a {currency} balance first.</p>
          )
        ) : canMove ? (
          <>
            <Toggle
              checked={moveMoney}
              onChange={setMoveMoney}
              label={dir === 'i_owe' ? 'Money came into an account' : 'Money left an account'}
              description={
                moveMoney
                  ? dir === 'i_owe'
                    ? 'Puts the money into that account now (not as income). It goes out again when you repay.'
                    : 'Takes the money out of that account now (not as spending). It comes back when they repay.'
                  : linkedBefore
                    ? 'Saving takes this money movement off, so that balance goes back.'
                    : dir === 'i_owe'
                      ? 'Off: only the debt is recorded. Your accounts change when you repay it.'
                      : 'Off: only the debt is recorded. Your accounts change when it’s repaid to you.'
              }
            />
            {moveMoney ? (
              <Field label="Account" hint={accountMissing ? 'Choose the account, or turn this off' : undefined}>
                <Select value={effectiveSubId} onChange={(e) => setSubId(e.target.value)}>
                  <option value="">Choose…</option>
                  <BalanceOptions subs={subsForCurrency} />
                </Select>
              </Field>
            ) : null}
          </>
        ) : (
          <p className="text-muted text-xs">Only the debt is recorded. Your accounts change when it’s repaid.</p>
        )}
      </div>
    </Sheet>
  )
}
