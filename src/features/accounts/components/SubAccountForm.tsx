import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, FormStack, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useSetBalance, useUpdateRows, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { d, parseAmount, toDb } from '@/domain/money'
import { DEFAULT_CURRENCY } from '@/domain/currency'
import type { SubAccount } from '@/api/database.types'

/**
 * Add or edit one currency balance inside an account. The amount is always the balance as it is
 * now; on a credit card it is entered as what you owe (stored below zero).
 */
export function SubAccountForm({
  open,
  onClose,
  accountId,
  isCard = false,
  initial,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  accountId: string
  isCard?: boolean
  initial?: SubAccount | null
  onDelete?: () => void
}) {
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('sub_accounts')
  const update = useUpdateRows('sub_accounts', { silent: true })
  const setBalance = useSetBalance()
  const [confirm, setConfirm] = useState(false)
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [archived, setArchived] = useState(false)

  // what the field shows for a stored balance: a card shows what you owe (the balance turned around)
  const shown = (balance: number | string) => (isCard ? d(balance).neg() : d(balance)).toString()

  // reset only when the sheet opens or another balance is picked: a background refresh of the same
  // balance (a new transaction, Cloud interest) must not wipe what is being typed
  useEffect(() => {
    if (!open) return
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setLabel(initial?.name ?? '')
    setAmount(initial ? shown(initial.balance) : '')
    setArchived(initial?.is_archived ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id])

  // a new balance may be left empty (= 0); an existing one needs a number so it is never zeroed by accident
  const typed = amount.trim() === '' && !initial ? d(0) : parseAmount(amount)
  const target = typed ? (isCard ? typed.neg() : typed) : null
  const busy = upsert.isPending || update.isPending || setBalance.isPending

  const save = async () => {
    if (!target) return
    if (!initial) {
      await upsert.mutateAsync([
        { id: newId(), account_id: accountId, currency, name: label.trim() || null, opening_balance: toDb(target), balance: toDb(target), is_archived: false },
      ])
      onClose()
      return
    }
    const patch: { name?: string | null; is_archived?: boolean } = {}
    if ((label.trim() || null) !== (initial.name ?? null)) patch.name = label.trim() || null
    if (archived !== initial.is_archived) patch.is_archived = archived
    if (Object.keys(patch).length) await update.mutateAsync([{ id: initial.id, ...patch }])
    // only when the amount was actually changed: re-saving a label must not overwrite a balance
    // that moved on another device since this sheet opened
    if (!target.eq(d(initial.balance))) await setBalance.mutateAsync({ sub: initial, balance: toDb(target) })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit balance' : 'Add currency balance'}
      footer={
        <div className="flex gap-3">
          {initial && onDelete ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete balance">
              <Trash2 className="text-negative h-4 w-4" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={() => save().catch(() => {}) /* the mutation already showed the error; the sheet stays open to retry */} loading={busy} disabled={!target}>
            {initial ? 'Save' : 'Add'}
          </Button>
        </div>
      }
    >
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete ${initial?.currency ?? ''} balance?`}
        message="Its own income and expenses are deleted with it. Transfers with your other balances stay on their side, so those balances don't change. Debt repayments, investment sales and certificate interest stay recorded."
        confirmLabel="Delete"
        onConfirm={() => {
          onDelete?.()
          onClose()
        }}
      />
      <FormStack>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={Boolean(initial)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.symbol}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" hint="Optional, e.g. Savings, Current">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field
          label={isCard ? 'Amount you owe now' : 'Current balance'}
          hint={
            amount.trim() !== '' && !typed
              ? 'Enter a number, e.g. 12500 or 12,500.50'
              : initial
                ? isCard
                  ? 'What the card statement or app shows you owe today. Your transactions stay as they are.'
                  : 'What the account really holds today. Your transactions stay as they are.'
                : isCard
                  ? 'What you owe on the card today'
                  : undefined
          }
        >
          <Input
            inputMode="decimal"
            className="tnum"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={amount.trim() !== '' && !typed}
          />
        </Field>
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hidden from lists and totals" /> : null}
      </FormStack>
    </Sheet>
  )
}
