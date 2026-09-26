import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ColorPicker, ConfirmDialog, Field, IconPicker, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useUpsert } from '@/lib/data/mutations'
import { useActiveCurrencies } from '@/lib/data/derived'
import { newId } from '@/lib/ids'
import { toDb } from '@/domain/money'
import type { Account, AccountType } from '@/lib/database.types'
import { ACCOUNT_TYPE_LABELS } from './hooks'

const DEFAULT_ICON: Record<AccountType, string> = { bank: 'landmark', cash: 'wallet', investment: 'trending-up', wallet: 'smartphone', other: 'coins' }

export function AccountForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Account | null }) {
  const currencies = useActiveCurrencies()
  const upsertAccount = useUpsert('accounts', { silent: true })
  const upsertSub = useUpsert('sub_accounts')
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('bank')
  const [color, setColor] = useState('#2563eb')
  const [icon, setIcon] = useState('landmark')
  const [notes, setNotes] = useState('')
  const [archived, setArchived] = useState(false)
  const [firstCurrency, setFirstCurrency] = useState('EGP')
  const [opening, setOpening] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setType(initial?.type ?? 'bank')
    setColor(initial?.color ?? '#2563eb')
    setIcon(initial?.icon ?? 'landmark')
    setNotes(initial?.notes ?? '')
    setArchived(initial?.is_archived ?? false)
    setFirstCurrency(currencies[0]?.code ?? 'EGP')
    setOpening('')
  }, [open, initial, currencies])

  const save = async () => {
    if (!name.trim()) return
    const id = initial?.id ?? newId()
    await upsertAccount.mutateAsync([{ id, name: name.trim(), type, color, icon, notes: notes || null, is_archived: archived }])
    if (!initial) {
      await upsertSub.mutateAsync([{ id: newId(), account_id: id, currency: firstCurrency, opening_balance: toDb(opening || 0), balance: toDb(opening || 0) }])
    }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit account' : 'New account'}
      footer={
        <Button full size="lg" onClick={save} loading={upsertAccount.isPending || upsertSub.isPending} disabled={!name.trim()}>
          {initial ? 'Save changes' : 'Add account'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CIB, Cash, Thndr" />
        </Field>
        <Field label="Type">
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as AccountType
              setType(t)
              if (!initial) setIcon(DEFAULT_ICON[t])
            }}
          >
            {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {!initial ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency" hint="You can add more currencies later">
              <Select value={firstCurrency} onChange={(e) => setFirstCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Current balance">
              <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" className="tnum" />
            </Field>
          </div>
        ) : null}
        <Field label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} color={color} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hidden from lists and totals" /> : null}
      </div>
    </Sheet>
  )
}

export function SubAccountForm({
  open,
  onClose,
  accountId,
  initial,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  accountId: string
  initial?: { id: string; currency: string; name: string | null; opening_balance: number; is_archived: boolean } | null
  onDelete?: () => void
}) {
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('sub_accounts')
  const [confirm, setConfirm] = useState(false)
  const [currency, setCurrency] = useState('EGP')
  const [label, setLabel] = useState('')
  const [opening, setOpening] = useState('')
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    if (!open) return
    setCurrency(initial?.currency ?? currencies[0]?.code ?? 'EGP')
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
        <div className="flex gap-2">
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
        message="Its transactions will be deleted as well. You can undo for a few seconds."
        onConfirm={() => {
          onDelete?.()
          onClose()
        }}
      />
      <div className="space-y-4">
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
      </div>
    </Sheet>
  )
}
