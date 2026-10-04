import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { AmountInput, Button, ConfirmDialog, Field, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useContacts, useSubAccounts } from '@/api/queries'
import { useUndoableDelete, useUpdateRows } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { d, toDb } from '@/domain/money'
import { formatDate, todayIso } from '@/domain/format'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'
import { nextMonthlyDate } from '@/domain/debts'
import type { RecurringDebt } from '@/api/database.types'

/** Change, pause or delete a monthly debt. Debts it already added stay as they are. */
export function RecurringDebtSheet({ open, onClose, rule }: { open: boolean; onClose: () => void; rule: RecurringDebt | null }) {
  const { data: contacts } = useContacts()
  const { data: subs } = useSubAccounts()
  const currencies = useActiveCurrencies()
  const update = useUpdateRows('recurring_debts', { invalidate: ['debts', 'transactions', 'sub_accounts'] })
  const remove = useUndoableDelete('recurring_debts', { label: 'Monthly debt' })
  const [amount, setAmount] = useState('')
  const [subId, setSubId] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [active, setActive] = useState(true)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open || !rule) return
    setAmount(String(rule.amount))
    setSubId(rule.sub_account_id)
    setEndDate(rule.end_date ?? '')
    setReason(rule.reason ?? '')
    setActive(rule.is_active)
  }, [open, rule])

  if (!rule) return null
  const who = contacts?.find((c) => c.id === rule.contact_id)?.name ?? 'Someone'
  const borrowing = rule.direction === 'i_owe'
  // (its own balance stays on the list even if it was archived since)
  const subsForCurrency = (subs ?? []).filter((s) => s.currency === rule.currency && (!s.is_archived || s.id === rule.sub_account_id))
  const endBeforeStart = Boolean(endDate) && endDate < rule.start_date
  const valid = d(amount).gt(0) && Boolean(subId) && !endBeforeStart
  const day = format(parseISO(rule.start_date), 'do')

  const save = async () => {
    if (!valid) return
    // turned back on after a pause: carry on from the next date, without adding the months it was paused
    const resumed = active && !rule.is_active
    const today = todayIso()
    await update.mutateAsync([
      {
        id: rule.id,
        amount: toDb(amount),
        sub_account_id: subId,
        end_date: endDate || null,
        reason: reason.trim() || null,
        is_active: active,
        ...(resumed && rule.next_date < today ? { next_date: nextMonthlyDate(rule.start_date, today) } : {}),
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={borrowing ? `Every month from ${who}` : `Every month to ${who}`}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
            <Trash2 className="text-negative h-4 w-4" />
          </Button>
          <Button full size="lg" onClick={save} loading={update.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-muted text-sm">
          On the {day} of every month, {borrowing ? 'the money comes into the account below and you owe it' : 'the money leaves the account below and they owe it'}.{' '}
          {rule.is_active ? `Next: ${formatDate(rule.next_date)}.` : 'Paused.'} Changes apply to the next ones; debts already added stay as they are.
        </p>
        <AmountInput value={amount} onChange={setAmount} currency={rule.currency} currencies={currencies} />
        <Field label={borrowing ? 'Comes into' : 'Leaves from'}>
          <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
            <BalanceOptions subs={subsForCurrency} />
          </Select>
        </Field>
        <Field label="Last date" hint={endBeforeStart ? 'Before the first date' : 'Blank = until you stop it'}>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Car" />
        </Field>
        <Toggle checked={active} onChange={setActive} label="Active" description={active ? 'A new debt is added every month' : 'Paused: nothing is added until you turn it back on'} />
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this monthly debt?"
        message="No more debts are added. The ones it already added stay."
        onConfirm={() => {
          remove(rule)
          onClose()
        }}
      />
    </Sheet>
  )
}
