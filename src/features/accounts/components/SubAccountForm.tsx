import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, FormStack, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { toDb } from '@/domain/money'
import { DEFAULT_CURRENCY } from '@/domain/currency'

export interface SubAccountFormValue {
  id: string
  currency: string
  name: string | null
  opening_balance: number
  is_archived: boolean
}

/** Add or edit one currency balance inside an account. */
export function SubAccountForm({ open, onClose, accountId, initial, onDelete }: { open: boolean; onClose: () => void; accountId: string; initial?: SubAccountFormValue | null; onDelete?: () => void }) {
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('sub_accounts')
  const [confirm, setConfirm] = useState(false)
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [label, setLabel] = useState('')
  const [opening, setOpening] = useState('')
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    if (!open) return
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setLabel(initial?.name ?? '')
    setOpening(initial ? String(initial.opening_balance) : '')
    setArchived(initial?.is_archived ?? false)
  }, [open, initial, currencies])

  const save = async () => {
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        account_id: accountId,
        currency,
        name: label.trim() || null,
        opening_balance: toDb(opening || 0),
        is_archived: archived,
        ...(initial ? {} : { balance: toDb(opening || 0) }),
      },
    ])
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
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending}>
            {initial ? 'Save' : 'Add'}
          </Button>
        </div>
      }
    >
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete ${initial?.currency ?? ''} balance?`}
        message="Its own transactions are deleted too. If it has transfers to other accounts or debt payments, it can't be deleted: archive it instead so your history stays correct."
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
        <Field label={initial ? 'Opening balance' : 'Current balance'} hint={initial ? 'Changing this shifts the current balance by the same amount' : undefined}>
          <Input inputMode="decimal" className="tnum" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
        </Field>
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" /> : null}
      </FormStack>
    </Sheet>
  )
}
