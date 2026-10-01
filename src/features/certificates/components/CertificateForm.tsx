import { useEffect, useState } from 'react'
import { addYears, format, parseISO } from 'date-fns'
import { AmountInput, Button, Field, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useAccounts, useSubAccounts } from '@/api/queries'
import { useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { newId } from '@/utils/ids'
import { d, toDb } from '@/domain/money'
import { PAYOUT_LABELS, payoutAmount, payoutSchedule } from '@/domain/certificates'
import { todayIso } from '@/domain/format'
import type { Certificate, PayoutFrequency } from '@/api/database.types'
import { DEFAULT_CURRENCY } from '@/domain/currency'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'

export function CertificateForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Certificate | null }) {
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const banks = (accounts ?? []).filter((a) => !a.is_archived && a.type !== 'cash')
  const currencies = useActiveCurrencies()
  const upsert = useUpsert('certificates', { invalidate: ['certificate_payouts'] })

  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [rate, setRate] = useState('')
  const [frequency, setFrequency] = useState<PayoutFrequency>('monthly')
  const [start, setStart] = useState(todayIso())
  const [maturity, setMaturity] = useState('')
  const [autoLog, setAutoLog] = useState(false)
  const [payoutSubId, setPayoutSubId] = useState('')
  const [notes, setNotes] = useState('')
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    if (!open) return
    setAccountId(initial?.account_id ?? banks[0]?.id ?? '')
    setName(initial?.name ?? '')
    setPrincipal(initial ? String(initial.principal) : '')
    setCurrency(initial?.currency ?? DEFAULT_CURRENCY)
    setRate(initial ? String(initial.interest_rate) : '')
    setFrequency(initial?.payout_frequency ?? 'monthly')
    setStart(initial?.start_date ?? todayIso())
    setMaturity(initial?.maturity_date ?? '')
    setAutoLog(initial?.auto_log_income ?? false)
    setPayoutSubId(initial?.payout_sub_account_id ?? '')
    setNotes(initial?.notes ?? '')
    setClosed(initial?.is_closed ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id])

  const payoutSubs = (subs ?? []).filter((s) => !s.is_archived && s.currency === currency)
  // the payout account must hold the certificate's currency; a stale choice from another currency is never sent
  const effectivePayoutSubId = payoutSubs.some((s) => s.id === payoutSubId) ? payoutSubId : ''
  const valid = accountId && name.trim() && d(principal).gt(0) && d(rate).gte(0) && start && maturity && maturity > start && (!autoLog || effectivePayoutSubId)
  const preview = valid
    ? {
        amount: payoutAmount({ principal, interest_rate: rate, payout_frequency: frequency, start_date: start, maturity_date: maturity }),
        count: payoutSchedule({ principal, interest_rate: rate, payout_frequency: frequency, start_date: start, maturity_date: maturity }).length,
      }
    : null

  const setYears = (y: number) => setMaturity(format(addYears(parseISO(start), y), 'yyyy-MM-dd'))

  const save = async () => {
    if (!valid) return
    await upsert.mutateAsync([
      {
        id: initial?.id ?? newId(),
        account_id: accountId,
        name: name.trim(),
        principal: toDb(principal),
        currency,
        interest_rate: d(rate).toFixed(4),
        payout_frequency: frequency,
        start_date: start,
        maturity_date: maturity,
        auto_log_income: autoLog,
        payout_sub_account_id: effectivePayoutSubId || null,
        notes: notes.trim() || null,
        is_closed: closed,
      },
    ])
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial ? 'Edit certificate' : 'New certificate'}
      footer={
        <Button full size="lg" onClick={save} loading={upsert.isPending} disabled={!valid}>
          Save
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Bank">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {!banks.length ? <option value="">Add a bank account first</option> : null}
            {banks.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 3-year 27% certificate" />
        </Field>
        <Field label="Principal">
          <AmountInput value={principal} onChange={setPrincipal} currency={currency} currencies={currencies} onCurrencyChange={setCurrency} />
        </Field>
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
          <Field label="Interest rate (% / year)">
            <Input inputMode="decimal" className="tnum" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="27" />
          </Field>
          <Field label="Payout">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as PayoutFrequency)}>
              {(Object.keys(PAYOUT_LABELS) as PayoutFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {PAYOUT_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Maturity date">
            <Input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          {[1, 3, 5].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYears(y)}
              className="bg-surface-2 text-muted hover:text-text rounded-full px-3 py-1 text-xs font-medium"
            >
              {y} year{y > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        {preview ? (
          <p className="bg-accent-soft text-accent rounded-xl px-3 py-2 text-sm">
            {preview.count} payout{preview.count === 1 ? '' : 's'} of{' '}
            <span className="tnum font-semibold">
              {preview.amount.toFixed(2)} {currency}
            </span>
          </p>
        ) : null}
        <Toggle
          checked={autoLog}
          onChange={setAutoLog}
          label="Auto-log payouts as income"
          description="Adds an Interest income transaction on each payout date"
        />
        {autoLog ? (
          <Field label="Payout account">
            <Select value={effectivePayoutSubId} onChange={(e) => setPayoutSubId(e.target.value)}>
              <option value="">Choose…</option>
              <BalanceOptions subs={payoutSubs} />
            </Select>
          </Field>
        ) : null}
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {initial ? <Toggle checked={closed} onChange={setClosed} label="Closed / redeemed" description="Excluded from net worth" /> : null}
      </div>
    </Sheet>
  )
}
