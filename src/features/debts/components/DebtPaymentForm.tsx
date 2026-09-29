import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AmountInput, Button, Field, Input, Select, Sheet, Textarea } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useSubAccounts } from '@/api/queries'
import { useRpc } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { useDebtViews } from '@/features/debts/useDebtViews'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'

/** Record a partial or full payment. Works standalone (choose the debt) or bound to one debt. */
export function DebtPaymentForm({ open, onClose, debtId }: { open: boolean; onClose: () => void; debtId?: string }) {
  const { open: openDebts } = useDebtViews()
  const navigate = useNavigate()
  const { data: subs } = useSubAccounts()
  const currencies = useActiveCurrencies()
  const prefs = usePrefs()
  const privacy = usePrefs((s) => s.privacy)
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

  // only balances in the debt's currency can receive or pay it
  const subsForCurrency = (subs ?? []).filter((s) => !s.is_archived && s.currency === debt?.currency)
  // pick a matching balance every time the sheet opens or the debt changes: the last one used if it matches, else the first
  useEffect(() => {
    if (!open || !debt) return
    setSubId(subsForCurrency.find((s) => s.id === prefs.lastSubAccountId)?.id ?? subsForCurrency[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt?.id, debt?.currency, subs])
  // what is actually sent: never an account in another currency, even if state is momentarily stale
  const effectiveSubId = subsForCurrency.some((s) => s.id === subId) ? subId : ''

  const overpay = debt ? d(amount).gt(debt.remaining) : false
  const valid = debt && d(amount).gt(0) && !overpay
  const save = async () => {
    if (!valid || !debt) return
    await record.mutateAsync({
      p_debt_id: debt.id,
      p_amount: toDb(amount),
      p_date: date,
      p_sub_account_id: effectiveSubId || null,
      p_notes: notes.trim() || null,
      p_payment_id: newId(),
      p_transaction_id: newId(),
    })
    if (effectiveSubId) prefs.remember({ lastSubAccountId: effectiveSubId })
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
        {!debtId && !openDebts.length ? (
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm text-muted">Nothing to pay: there are no open debts. Record money you lent or borrowed first.</p>
            <Button
              variant="soft"
              onClick={() => {
                onClose()
                navigate('/debts')
              }}
            >
              Go to debts
            </Button>
          </div>
        ) : !debtId ? (
          <Field label="Debt">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {openDebts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.direction === 'i_owe' ? 'I owe' : 'Owed to me'} · {x.contact?.name}
                  {privacy ? '' : ` · ${x.remaining.toFixed(0)} ${x.currency}`}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {debt ? (
          <>
            <p className="text-muted text-sm">
              Remaining: <Amount value={debt.remaining} currency={debt.currency} className="font-medium text-text" />
            </p>
            <AmountInput value={amount} onChange={setAmount} currency={debt.currency} currencies={currencies} />
            {overpay ? (
              <p className="text-negative -mt-2 text-xs">
                That is more than the <Amount value={debt.remaining} currency={debt.currency} size="sm" /> left on this debt.
              </p>
            ) : null}
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={debt.direction === 'i_owe' ? 'Paid from' : 'Received into'} hint="Leave empty if no account was involved">
              <Select value={effectiveSubId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">No account</option>
                <BalanceOptions subs={subsForCurrency} />
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
