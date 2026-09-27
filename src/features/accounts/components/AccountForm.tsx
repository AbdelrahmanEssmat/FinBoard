import { useEffect, useState } from 'react'
import { Button, ColorPicker, Field, FormStack, IconPicker, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { toDb } from '@/domain/money'
import type { Account, AccountType } from '@/api/database.types'
import { ACCOUNT_TYPE_LABELS } from '@/features/accounts/useAccountsWithBalances'
import { DEFAULT_CURRENCY } from '@/domain/currency'
import { isLiquidType } from '@/domain/liquidity'

const DEFAULT_ICON: Record<AccountType, string> = { bank: 'landmark', cash: 'wallet', investment: 'trending-up', wallet: 'smartphone', other: 'coins' }

/** Create or edit an account (bank, cash, platform…). New accounts get their first currency balance here too. */
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
  const [firstCurrency, setFirstCurrency] = useState(DEFAULT_CURRENCY)
  const [opening, setOpening] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setType(initial?.type ?? 'bank')
    setColor(initial?.color ?? '#2563eb')
    setIcon(initial?.icon ?? 'landmark')
    setNotes(initial?.notes ?? '')
    setArchived(initial?.is_archived ?? false)
    setFirstCurrency(DEFAULT_CURRENCY)
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
      <FormStack>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CIB, Cash, Thndr" />
        </Field>
        <Field label="Type" hint={isLiquidType(type) ? 'Counts as liquid money (spendable any time)' : 'Not counted as liquid money'}>
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
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
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
      </FormStack>
    </Sheet>
  )
}
