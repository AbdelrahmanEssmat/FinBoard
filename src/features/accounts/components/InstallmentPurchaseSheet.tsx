import { useEffect, useMemo, useState } from 'react'
import { AmountInput, Button, Field, Input, Select, Sheet } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useCategories } from '@/api/queries'
import { useSaveTransaction, useUpsert } from '@/api/mutations'
import { useActiveCurrencies } from '@/hooks/useMoney'
import { useCreditCards } from '@/hooks/useCreditCards'
import { d, toDb } from '@/domain/money'
import { formatDate, todayIso } from '@/domain/format'
import { firstBillingDate, installmentSchedule } from '@/domain/creditCard'
import { newId } from '@/utils/ids'
import { cn } from '@/utils'
import { CategoryPicker } from '@/features/categories/components/CategoryPicker'

const MONTH_CHOICES = [3, 6, 9, 12, 18, 24, 36]

export interface InstallmentPreset {
  cardAccountId?: string
  amount?: string
  description?: string
  categoryId?: string | null
  date?: string
}

/**
 * Buy something on a credit card and pay it over several statements. Saves the purchase (full
 * price, so spending shows when you bought it), the interest / fees if any (as a card fee), and
 * the plan that bills one installment per statement.
 */
export function InstallmentPurchaseSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: InstallmentPreset }) {
  const { cards } = useCreditCards()
  const { data: categories } = useCategories()
  const currencies = useActiveCurrencies()
  const saveTx = useSaveTransaction()
  const savePlan = useUpsert('card_installment_plans')
  // plans need the statement day to know when each installment is billed
  const usable = cards.filter((c) => c.primary && c.account.statement_day)

  const [cardId, setCardId] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState(12)
  const [customMonths, setCustomMonths] = useState('')
  const [fees, setFees] = useState('')
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCardId(preset?.cardAccountId && usable.some((c) => c.account.id === preset.cardAccountId) ? preset.cardAccountId : (usable[0]?.account.id ?? ''))
    setDescription(preset?.description ?? '')
    setCategoryId(preset?.categoryId ?? null)
    setAmount(preset?.amount ?? '')
    setMonths(12)
    setCustomMonths('')
    setFees('')
    setDate(preset?.date ?? todayIso())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const card = usable.find((c) => c.account.id === cardId)
  const n = customMonths ? Number(customMonths) : months
  const statementDay = card?.account.statement_day ?? 1
  const principal = d(amount || 0)
  const feeAmount = d(fees || 0)
  const plan = useMemo(() => {
    if (!card || !principal.gt(0) || !(n >= 2 && n <= 120)) return null
    const first = firstBillingDate(date, statementDay)
    const schedule = installmentSchedule({ principal, fees: feeAmount, months: n, purchase_date: date, first_billing_date: first }, statementDay)
    return { first, schedule, monthly: schedule[0]!.amount, last: schedule[schedule.length - 1]!, total: principal.plus(feeAmount) }
  }, [card, principal, feeAmount, n, date, statementDay])
  const availableAfter = card?.usage.available ? card.usage.available.minus(plan?.total ?? 0) : null
  const valid = Boolean(card && plan && description.trim() && feeAmount.gte(0))

  const save = async () => {
    if (!valid || !card || !plan || !card.primary) return
    setSaving(true)
    try {
      const purchaseId = newId()
      const base = { type: 'expense' as const, date, currency: card.currency, sub_account_id: card.primary.id, tags: [], to_sub_account_id: null, to_amount: null, to_currency: null, rate_used: null, source: 'manual' as const, source_id: null }
      await saveTx.mutateAsync({ row: { ...base, id: purchaseId, amount: toDb(principal), category_id: categoryId, payee: description.trim(), notes: `${n} installments of ${plan.monthly.toFixed(2)} ${card.currency}` } })
      let feesId: string | null = null
      if (feeAmount.gt(0)) {
        feesId = newId()
        const feeCategory = categories?.find((c) => c.kind === 'expense' && /fee|charge/i.test(c.name) && !c.parent_id)
        await saveTx.mutateAsync({ row: { ...base, id: feesId, amount: toDb(feeAmount), category_id: feeCategory?.id ?? null, payee: `${description.trim()} · installment interest & fees`, notes: null } })
      }
      await savePlan.mutateAsync([
        {
          id: newId(),
          account_id: card.account.id,
          sub_account_id: card.primary.id,
          transaction_id: purchaseId,
          fees_transaction_id: feesId,
          description: description.trim(),
          currency: card.currency,
          principal: toDb(principal),
          fees: toDb(feeAmount),
          months: n,
          purchase_date: date,
          first_billing_date: plan.first,
        },
      ])
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Installment purchase"
      footer={
        <Button full size="lg" onClick={save} loading={saving} disabled={!valid}>
          Save plan
        </Button>
      }
    >
      {!usable.length ? (
        <p className="pb-4 text-sm leading-relaxed text-muted">
          {cards.length ? 'Set the statement day on your card first (edit the card), so FinBoard knows when each installment is billed.' : 'Add a credit card first (Accounts → Add → Credit card).'}
        </p>
      ) : (
        <div className="space-y-5">
          <Field label="Card">
            <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {usable.map((c) => (
                <option key={c.account.id} value={c.account.id}>
                  {c.account.name} · {c.currency}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What did you buy?">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. iPhone, fridge, laptop" />
          </Field>
          <Field label="Price">
            <AmountInput value={amount} onChange={setAmount} currency={card?.currency ?? 'EGP'} currencies={currencies} />
          </Field>
          <Field label="Months">
            <div className="flex flex-wrap gap-2">
              {MONTH_CHOICES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMonths(m)
                    setCustomMonths('')
                  }}
                  className={cn('h-10 min-w-12 rounded-full px-3.5 text-sm font-medium transition-colors', !customMonths && months === m ? 'bg-accent text-white' : 'bg-surface-2 text-muted hover:text-text')}
                >
                  {m}
                </button>
              ))}
              <Input inputMode="numeric" value={customMonths} onChange={(e) => setCustomMonths(e.target.value.replace(/\D/g, ''))} placeholder="Other" className="h-10 w-20 text-center" aria-label="Other number of months" />
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
            <Field label="Interest & fees" hint="Total; 0 for 0% plans">
              <Input inputMode="decimal" className="tnum" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Date bought">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Category">
            <CategoryPicker kind="expense" value={categoryId} onChange={setCategoryId} />
          </Field>

          {plan && card ? (
            <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">Each month</span>
                <Amount value={plan.monthly} currency={card.currency} className="text-base font-semibold" />
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <span>Total cost</span>
                <Amount value={plan.total} currency={card.currency} />
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <span>First installment</span>
                <span>statement of {formatDate(plan.first, 'd MMM yyyy')}</span>
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <span>Last installment</span>
                <span>{formatDate(plan.last.date, 'd MMM yyyy')}</span>
              </div>
              {availableAfter ? (
                <div className={cn('flex justify-between gap-3 border-t border-border pt-2', availableAfter.lt(0) ? 'text-negative' : 'text-muted')}>
                  <span>{availableAfter.lt(0) ? 'Over the limit by' : 'Credit left after this'}</span>
                  <Amount value={availableAfter.abs()} currency={card.currency} decimals={0} />
                </div>
              ) : null}
              <p className="pt-1 text-xs leading-relaxed text-muted">The bank holds the full amount from your limit; each statement bills one installment.</p>
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}
