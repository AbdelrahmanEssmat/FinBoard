import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Field, FormStack, Input, Segmented, Select, Sheet, Toggle } from '@/components/ui'
import { useAccounts } from '@/api/queries'
import { useUndoableDelete, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
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
  const remove = useUndoableDelete('sub_accounts', { invalidate: ['transactions'], label: 'Cloud' })
  const platforms = (accounts ?? []).filter((a) => !a.is_archived && a.type === 'investment')
  const others = (accounts ?? []).filter((a) => !a.is_archived && a.type !== 'investment')

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
    setOpening(initial ? String(initial.opening_balance) : '')
    setArchived(initial?.is_archived ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const valid = accountId && name.trim() && d(rate).gte(0)
  const preview = d(opening).gt(0) || initial ? projectedMonthlyYield(initial ? initial.balance : opening, rate, frequency) : null

  const save = async () => {
    if (!valid) return
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        account_id: accountId,
        name: name.trim(),
        currency,
        yield_rate: d(rate).toFixed(4),
        yield_frequency: frequency,
        yield_since: since || null,
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
      title={initial ? 'Edit Cloud' : 'New Cloud'}
      footer={
        <div className="flex gap-3">
          {initial ? (
            <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-negative" />
            </Button>
          ) : null}
          <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!valid}>
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
                className="rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-medium text-accent"
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
          <Field label="Yearly rate (%)">
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
        <Field label="Interest is paid">
          <Segmented value={frequency} onChange={setFrequency} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily' }]} />
        </Field>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label={frequency === 'monthly' ? 'First deposit date' : 'Start date'} hint={frequency === 'monthly' ? 'Interest lands on this day each month' : 'Interest starts the next day'}>
            <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </Field>
          <Field label={initial ? 'Opening balance' : 'Current balance'} hint={initial ? 'Changing this shifts the balance by the difference' : undefined}>
            <Input inputMode="decimal" className="tnum" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        {preview && d(rate).gt(0) ? (
          <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-sm text-accent">
            About <span className="tnum font-semibold">{preview.toFixed(2)} {currency}</span> a month · {effectiveAnnualRate(rate, frequency).toFixed(2)}% effective yearly
          </p>
        ) : null}
        {initial ? <Toggle checked={archived} onChange={setArchived} label="Archived" description="Hidden from lists and totals" /> : null}
      </FormStack>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this Cloud?"
        message="Its transactions, including posted interest, will be deleted too."
        onConfirm={() => {
          if (initial) remove(initial)
          onClose()
        }}
      />
    </Sheet>
  )
}
