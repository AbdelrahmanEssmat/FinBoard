import { useEffect, useMemo, useState } from 'react'
import { AmountInput, Button, Field, Input, Select, Sheet, Textarea } from '@/components/ui'
import { useAccounts, useSubAccounts } from '@/api/queries'
import { useRpc } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { newId } from '@/utils/ids'
import { byId } from '@/utils'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { useDebtViews } from '@/features/debts/useDebtViews'

/** Record a partial or full payment. Works standalone (choose the debt) or bound to one debt. */
export function DebtPaymentForm({ open, onClose, debtId }: { open: boolean; onClose: () => void; debtId?: string }) {
  const { open: openDebts } = useDebtViews()
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const currencies = useActiveCurrencies()
  const prefs = usePrefs()
  const record = useRpc('record_debt_payment', ['debt_payments', 'debts', 'transactions', 'sub_accounts'])

  const [selected, setSelected] = useState(debtId ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [subId, setSubId] = useState('')
  const [notes, setNotes] = useState('')
  const debt = openDebts.find((x) => x.id === selected)

  useEffect(() => {
    if (!open) return
    setSelected(debtId ?? openDebts[0]?.id ?? '')
    setAmount('')
    setDate(todayIso())
    setNotes('')
    setSubId(prefs.lastSubAccountId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debtId])

  // Prefill with the next installment (or the whole remainder) whenever the sheet opens or the debt changes
  useEffect(() => {
    if (open && debt) setAmount(debt.next ? debt.next.amount.minus(debt.next.paid).toString() : debt.remaining.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt?.id])

  const subsForCurrency = (subs ?? []).filter((s) => !s.is_archived && s.currency === debt?.currency)
  useEffect(() => {
    if (subsForCurrency.length && !subsForCurrency.some((s) => s.id === subId)) setSubId(subsForCurrency[0]!.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt?.currency, subs])

  const valid = debt && d(amount).gt(0)
  const save = async () => {
    if (!valid || !debt) return
    await record.mutateAsync({
      p_debt_id: debt.id,
      p_amount: toDb(amount),
      p_date: date,
      p_sub_account_id: subId || null,
      p_notes: notes.trim() || null,
      p_payment_id: newId(),
      p_transaction_id: newId(),
    })
    if (subId) prefs.remember({ lastSubAccountId: subId })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={debt?.direction === 'i_owe' ? 'Pay back' : 'Record repayment'}
      footer={
        <Button full size="lg" onClick={save} loading={record.isPending} disabled={!valid}>
          Save payment
        </Button>
      }
    >
      <div className="space-y-5">
        {!debtId ? (
          <Field label="Debt">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {!openDebts.length ? <option value="">No open debts</option> : null}
              {openDebts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.direction === 'i_owe' ? 'I owe' : 'Owed to me'} · {x.contact?.name} · {x.remaining.toFixed(0)} {x.currency}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {debt ? (
          <>
            <p className="text-sm text-muted">
              Remaining: <span className="tnum font-medium text-text">{debt.remaining.toFixed(2)} {debt.currency}</span>
            </p>
            <AmountInput value={amount} onChange={setAmount} currency={debt.currency} currencies={currencies} />
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={debt.direction === 'i_owe' ? 'Paid from' : 'Received into'} hint="Leave empty if no account was involved">
              <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">No account</option>
                {subsForCurrency.map((s) => (
                  <option key={s.id} value={s.id}>
                    {accMap.get(s.account_id)?.name} · {s.currency}
                    {s.name ? ' · ' + s.name : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
