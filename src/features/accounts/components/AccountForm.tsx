import { useEffect, useState } from 'react'
import { Button, ColorPicker, Field, FormStack, IconPicker, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { useAccounts } from '@/api/queries'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
import type { Account, AccountType } from '@/api/database.types'
import { ACCOUNT_TYPE_LABELS } from '@/features/accounts/useAccountsWithBalances'
import { DEFAULT_CURRENCY } from '@/domain/currency'
import { isLiquidType } from '@/domain/liquidity'

const DEFAULT_ICON: Record<AccountType, string> = {
  bank: 'landmark',
  cash: 'wallet',
  investment: 'trending-up',
  wallet: 'smartphone',
  credit_card: 'credit-card',
  other: 'coins',
}

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
  // credit card settings
  const [limit, setLimit] = useState('')
  const [statementDay, setStatementDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [minPct, setMinPct] = useState('5')
  const [bankId, setBankId] = useState('')
  const { data: allAccounts } = useAccounts()
  const banks = (allAccounts ?? []).filter((a) => a.type === 'bank' && !a.is_archived && a.id !== initial?.id)
  const isCard = type === 'credit_card'

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
    setLimit(initial?.credit_limit != null ? String(initial.credit_limit) : '')
    setStatementDay(initial?.statement_day ? String(initial.statement_day) : '')
    setDueDay(initial?.due_day ? String(initial.due_day) : '')
    setMinPct(initial?.min_payment_pct != null ? String(initial.min_payment_pct) : '5')
    setBankId(initial?.bank_account_id ?? '')
  }, [open, initial, currencies])

  const save = async () => {
    if (!name.trim()) return
    const id = initial?.id ?? newId()
    const card = isCard
      ? {
          credit_limit: d(limit || 0).gt(0) ? toDb(limit) : null,
          statement_day: statementDay ? Number(statementDay) : null,
          due_day: dueDay ? Number(dueDay) : null,
          min_payment_pct: minPct !== '' && d(minPct).gte(0) ? d(minPct).toFixed(3) : null,
          bank_account_id: bankId || null,
        }
      : { credit_limit: null, statement_day: null, due_day: null, min_payment_pct: null, bank_account_id: null }
    await upsertAccount.mutateAsync([{ id, name: name.trim(), type, color, icon, notes: notes || null, is_archived: archived, ...card }])
    if (!initial) {
      // on a card, what you owe is a balance below zero
      const start = isCard
        ? d(opening || 0)
            .abs()
            .neg()
        : d(opening || 0)
      await upsertSub.mutateAsync([{ id: newId(), account_id: id, currency: firstCurrency, opening_balance: toDb(start), balance: toDb(start) }])
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
        <Field
          label="Type"
          hint={
            isCard
              ? 'Borrowed money: shown as what you owe, never as liquid money'
              : isLiquidType(type)
                ? 'Counts as liquid money (spendable any time)'
                : 'Not counted as liquid money'
          }
        >
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
            <Field label={isCard ? 'Amount you owe now' : 'Current balance'}>
              <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" className="tnum" />
            </Field>
          </div>
        ) : null}
        {isCard ? (
          <div className="bg-surface-2 space-y-5 rounded-2xl p-4">
            <Field label="Issuing bank" hint="The bank the card is from: it's named after it and paid from it by default">
              <Select
                value={bankId}
                onChange={(e) => {
                  setBankId(e.target.value)
                  // a new card with no name yet is named after its bank ("NBE" → shown as "NBE credit card")
                  const bank = banks.find((b) => b.id === e.target.value)
                  if (bank && !name.trim()) setName(bank.name)
                }}
              >
                <option value="">Not linked</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Credit limit" hint={initial ? 'In the card\u2019s main currency' : `In ${firstCurrency}`}>
              <Input inputMode="decimal" className="tnum" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 50000" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Statement day">
                <Select value={statementDay} onChange={(e) => setStatementDay(e.target.value)}>
                  <option value="">Not set</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Payment due day">
                <Select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
                  <option value="">Not set</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Minimum payment (%)" hint={'Of the statement balance; your bank\u2019s terms, often 3\u20135%'}>
              <Input inputMode="decimal" className="tnum" value={minPct} onChange={(e) => setMinPct(e.target.value)} placeholder="5" />
            </Field>
            <p className="text-muted text-xs leading-relaxed">
              Spend with the card by adding an expense on it. Pay it with a transfer from your bank to the card. With the statement and due days set, FinBoard
              tracks each statement, the minimum and the due date.
            </p>
          </div>
        ) : null}
        <Field label="Colour" group>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Icon" group>
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
