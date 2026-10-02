import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, FormStack, Input, Segmented, Select, Sheet, Toggle } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useAccounts } from '@/api/queries'
import { useSetBalance, useUndoableDelete, useUpdateRows, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { d, parseAmount, toDb } from '@/domain/money'
import { effectiveAnnualRate, projectedMonthlyYield, type YieldFrequency } from '@/domain/yield'
import { todayIso } from '@/domain/format'
import type { SubAccount } from '@/api/database.types'
import { DEFAULT_CURRENCY } from '@/domain/currency'

const PRESETS: { label: string; rate: string; frequency: YieldFrequency }[] = [
  { label: 'Thndr Monthly Cloud · 20.29%', rate: '20.29', frequency: 'monthly' },
  { label: 'Thndr Daily Cloud · 17.31%', rate: '17.31', frequency: 'daily' },
]

/** Create or edit a Cloud: a balance that earns a yearly rate, paid daily or monthly. */
export function CloudForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: SubAccount | null }) {
  const { data: accounts } = useAccounts()
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('sub_accounts', { invalidate: ['transactions'] })
  const update = useUpdateRows('sub_accounts', { invalidate: ['transactions'], silent: true })
  const setBalance = useSetBalance()
  const remove = useUndoableDelete('sub_accounts', { invalidate: ['transactions'], label: 'Cloud' })
  const platforms = (accounts ?? []).filter((a) => !a.is_archived && a.type === 'investment')
  // never a credit card: a Cloud there would be counted as card credit in net worth
  const others = (accounts ?? []).filter((a) => !a.is_archived && a.type !== 'investment' && a.type !== 'credit_card')

  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [rate, setRate] = useState('')
  const [frequency, setFrequency] = useState<YieldFrequency>('monthly')
  const [since, setSince] = useState(todayIso())
  const [opening, setOpening] = useState('')
  const [archived, setArchived] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setAccountId(initial?.account_id ?? platforms[0]?.id ?? others[0]?.id ?? '')
    setName(initial?.name ?? 'Monthly Cloud')
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setRate(initial?.yield_rate != null ? String(initial.yield_rate) : '20.29')
    setFrequency(initial?.yield_frequency === 'daily' ? 'daily' : 'monthly')
    setSince(initial?.yield_since ?? todayIso())
    setOpening(initial ? String(initial.balance) : '')
    setArchived(initial?.is_archived ?? false)
    // only when the sheet opens or another Cloud is picked: a background refresh (interest posted
    // while the sheet is open) must not wipe what is being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id])

  // a new Cloud may start empty; an existing one needs a number so it is never zeroed by accident
  const balance = opening.trim() === '' && !initial ? d(0) : parseAmount(opening)
  const rateOk = parseAmount(rate)?.gte(0) ?? false
  // a monthly Cloud pays on the day of its first deposit each month: without that date it never pays
  const sinceMissing = frequency === 'monthly' && !since
  const valid = Boolean(accountId && name.trim() && rateOk && balance && !sinceMissing)
  const preview = balance?.gt(0) ? projectedMonthlyYield(balance, rate, frequency) : null
  const busy = upsert.isPending || update.isPending || setBalance.isPending

  const save = async () => {
    if (!valid || !balance) return
    const fields = { name: name.trim(), yield_rate: d(rate).toFixed(4), yield_frequency: frequency, yield_since: since || null, is_archived: archived }
    if (!initial) {
      await upsert.mutateAsync([{ id: newId(), account_id: accountId, currency, ...fields, opening_balance: toDb(balance), balance: toDb(balance) }])
    } else {
      await update.mutateAsync([{ id: initial.id, ...fields }])
      // the balance as it is now; only sent when it was changed, so saving a new rate never
      // overwrites interest posted since the sheet opened
      if (!balance.eq(d(initial.balance))) await setBalance.mutateAsync({ sub: initial, balance: toDb(balance) })
    }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Cloud' : 'New Cloud'}
      footer={
        <div className="flex gap-3">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="text-negative h-4 w-4" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={() => save().catch(() => {}) /* the mutation already showed the error; the sheet stays open to retry */} loading={busy} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <FormStack>
        {!initial ? (
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setRate(p.rate)
                  setFrequency(p.frequency)
                  setName(p.frequency === 'daily' ? 'Daily Cloud' : 'Monthly Cloud')
                }}
                className="bg-accent-soft text-accent min-h-10 rounded-full px-3.5 text-xs font-medium"
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Platform">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={Boolean(initial)}>
            {[...platforms, ...others].map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly Cloud" />
        </Field>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label="Yearly rate (%)" hint={initial && initial.yield_rate != null && parseAmount(rate)?.eq(initial.yield_rate) === false ? "The new rate counts from today" : undefined}>
            <Input inputMode="decimal" className="tnum" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="20.29" />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={Boolean(initial)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Interest is paid" group>
          <Segmented
            value={frequency}
            onChange={setFrequency}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field
            label={frequency === 'monthly' ? 'First deposit date' : 'Start date'}
            hint={sinceMissing ? 'Needed: interest is paid on this day each month' : frequency === 'monthly' ? 'Interest lands on this day each month' : 'Interest starts the next day'}
          >
            <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </Field>
          <Field
            label="Current balance"
            hint={opening.trim() !== '' && !balance ? 'Enter a number, e.g. 25000' : initial ? 'What the platform shows today' : undefined}
          >
            <Input
              inputMode="decimal"
              className="tnum"
              aria-invalid={opening.trim() !== '' && !balance}
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        {preview && d(rate).gt(0) ? (
          <p className="bg-accent-soft text-accent rounded-xl px-4 py-2.5 text-sm">
            About <Amount value={preview} currency={currency} className="font-semibold" /> a month · {effectiveAnnualRate(rate, frequency).toFixed(2)}%
            effective yearly
          </p>
        ) : null}
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hidden from lists and totals" /> : null}
      </FormStack>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this Cloud?"
        message="Its posted interest is deleted with it. Money you moved in from other balances stays recorded there, so those balances don't change."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
