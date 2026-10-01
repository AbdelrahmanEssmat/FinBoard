import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AmountInput, Button, ConfirmDialog, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { useAccounts, useCategories, useInstallmentPlans, usePayeeHistory, useSubAccounts } from '@/api/queries'
import { InstallmentPurchaseSheet, type InstallmentPreset } from '@/features/accounts/components/InstallmentPurchaseSheet'
import { lastCategoryByParty } from '@/domain/categoryStats'
import { useCreditCards } from '@/hooks/useCreditCards'
import { formatDate } from '@/domain/format'
import { Amount } from '@/components/shared'
import { useSaveTransaction, useUndoableDeleteTransaction } from '@/api/mutations'
import { useConvert, useActiveCurrencies } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { newId } from '@/utils/ids'
import { byId } from '@/utils'
import { d, toDb } from '@/domain/money'
import { todayIso } from '@/domain/format'
import type { Transaction, TransactionType } from '@/api/database.types'
import { CategoryPicker } from '@/features/categories/components/CategoryPicker'
import { DEFAULT_CURRENCY, defaultFirst } from '@/domain/currency'
import { BalanceOptions } from '@/features/accounts/components/BalanceOptions'

export function TransactionForm({
  open,
  onClose,
  initial,
  defaultType = 'expense',
  onSaved,
  presetSubAccountId,
  presetToSubAccountId,
  presetCategoryId,
  presetAmount,
}: {
  open: boolean
  onClose: () => void
  initial?: Transaction | null
  defaultType?: TransactionType
  onSaved?: () => void
  /** Pre-select the source / destination balance (e.g. deposit into a Cloud) */
  presetSubAccountId?: string
  presetToSubAccountId?: string
  /** Pre-select the category (e.g. adding from a category's page) */
  presetCategoryId?: string
  /** Pre-fill the amount (e.g. paying a card's statement) */
  presetAmount?: string
}) {
  const { data: subs } = useSubAccounts()
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories()
  const currencies = useActiveCurrencies()
  const { between } = useConvert()
  const prefs = usePrefs()
  const save = useSaveTransaction()
  const remove = useUndoableDeleteTransaction()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const activeSubs = useMemo(() => (subs ?? []).filter((s) => !s.is_archived && !accMap.get(s.account_id)?.is_archived), [subs, accMap])

  const [type, setType] = useState<TransactionType>(defaultType)
  const [amount, setAmount] = useState('')
  const [subId, setSubId] = useState('')
  const [toSubId, setToSubId] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [payee, setPayee] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [confirm, setConfirm] = useState(false)
  // once the user picks a category themselves, a remembered payer's category no longer replaces it
  const [categoryTouched, setCategoryTouched] = useState(false)
  const { data: payeeHistory } = usePayeeHistory()
  const payeeCategory = useMemo(() => lastCategoryByParty(payeeHistory ?? []), [payeeHistory])
  // names used before for this type, most recent first (suggested as you type)
  const payeeSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of payeeHistory ?? []) {
      const name = (t.payee ?? '').trim()
      if (!name || t.type !== type || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      out.push(name)
      if (out.length >= 60) break
    }
    return out
  }, [payeeHistory, type])

  const sub = activeSubs.find((s) => s.id === subId) ?? subs?.find((s) => s.id === subId)
  const toSub = activeSubs.find((s) => s.id === toSubId)
  const currency = sub?.currency ?? DEFAULT_CURRENCY
  const toCurrency = toSub?.currency ?? currency
  const crossCurrency = type === 'transfer' && toCurrency !== currency
  // transactions created by a debt payment, certificate payout or Cloud interest are tied to that record:
  // amount, account and date are changed there, not here (notes, tags and category stay editable)
  // a purchase paid in installments: its amount, card and date belong to the plan
  const { data: plans } = useInstallmentPlans()
  const planOfTx = initial ? (plans ?? []).find((p) => p.transaction_id === initial.id || p.fees_transaction_id === initial.id) : undefined
  const [installments, setInstallments] = useState<InstallmentPreset | null>(null)
  const linked =
    Boolean(initial && (initial.source === 'debt' || initial.source === 'certificate' || initial.source === 'yield' || initial.source === 'investment')) ||
    Boolean(planOfTx)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setType(initial.type)
      setAmount(String(initial.amount))
      setSubId(initial.sub_account_id)
      setToSubId(initial.to_sub_account_id ?? '')
      setToAmount(initial.to_amount != null ? String(initial.to_amount) : '')
      setCategoryId(initial.category_id)
      setDate(initial.date)
      setPayee(initial.payee ?? '')
      setNotes(initial.notes ?? '')
      setTags(initial.tags.join(', '))
    } else {
      setType(defaultType)
      setAmount(presetAmount ?? '')
      // default to an EGP balance: the last one used if it is EGP, else the first EGP balance
      const ordered = defaultFirst(activeSubs)
      // paying a credit card: pay from a bank balance in the card's currency (never from a card)
      const payingCard = presetToSubAccountId
        ? activeSubs.find((s) => s.id === presetToSubAccountId && accMap.get(s.account_id)?.type === 'credit_card')
        : undefined
      // the card's own bank first (when the card is linked to it)
      const issuingBankId = payingCard ? accMap.get(payingCard.account_id)?.bank_account_id : null
      const bankForCard = payingCard
        ? ((issuingBankId
            ? activeSubs.find((s) => s.account_id === issuingBankId && s.currency === payingCard.currency && s.yield_rate === null)
            : undefined) ??
          activeSubs.find(
            (s) => s.id === prefs.lastSubAccountId && s.currency === payingCard.currency && accMap.get(s.account_id)?.type === 'bank' && s.yield_rate === null,
          ) ??
          activeSubs.find((s) => s.currency === payingCard.currency && accMap.get(s.account_id)?.type === 'bank' && s.yield_rate === null) ??
          activeSubs.find((s) => s.currency === payingCard.currency && accMap.get(s.account_id)?.type !== 'credit_card' && s.yield_rate === null))
        : undefined
      const preferred =
        activeSubs.find((s) => s.id === presetSubAccountId) ??
        bankForCard ??
        activeSubs.find((s) => s.id === prefs.lastSubAccountId && s.currency === DEFAULT_CURRENCY && s.id !== presetToSubAccountId) ??
        ordered.find((s) => s.id !== presetToSubAccountId)
      setSubId(preferred?.id ?? '')
      setToSubId(presetToSubAccountId ?? ordered.find((s) => s.id !== preferred?.id)?.id ?? '')
      setToAmount('')
      setCategoryId(presetCategoryId ?? (defaultType === 'income' ? prefs.lastIncomeCategoryId : prefs.lastExpenseCategoryId))
      setCategoryTouched(Boolean(presetCategoryId))
      setDate(todayIso())
      setPayee('')
      setNotes('')
      setTags('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultType])

  // suggest converted amount for cross-currency transfers
  useEffect(() => {
    if (!crossCurrency || !open) return
    const conv = between(amount || 0, currency, toCurrency)
    // keep the saved received amount only while both currencies are unchanged; otherwise suggest a fresh one
    const keepSaved = initial && initial.to_amount != null && initial.to_currency === toCurrency && initial.currency === currency
    if (conv && !keepSaved) setToAmount(conv.toDecimalPlaces(2).toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, currency, toCurrency, crossCurrency, open])

  // keep category kind in sync with type
  useEffect(() => {
    if (type === 'transfer') return
    const cat = categories?.find((c) => c.id === categoryId)
    if (cat && cat.kind !== type) setCategoryId(type === 'income' ? prefs.lastIncomeCategoryId : prefs.lastExpenseCategoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  // credit cards: available credit when spending on one, the statement when paying one
  const { cards } = useCreditCards()
  const spendCard = type !== 'transfer' && sub ? cards.find((c) => c.subs.some((s) => s.id === sub.id)) : undefined
  const payCard = type === 'transfer' && toSub ? cards.find((c) => c.subs.some((s) => s.id === toSub.id)) : undefined
  const overLimit = Boolean(
    type === 'expense' &&
    spendCard?.usage.available &&
    sub?.currency === spendCard.currency &&
    d(amount || 0)
      .minus(initial?.type === 'expense' && initial.sub_account_id === sub.id ? d(initial.amount) : 0)
      .gt(spendCard.usage.available),
  )

  const valid = d(amount).gt(0) && subId && (type !== 'transfer' || (toSubId && toSubId !== subId && (!crossCurrency || d(toAmount).gt(0))))

  const submit = async () => {
    if (!valid) return
    const id = initial?.id ?? newId()
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const rateUsed = crossCurrency && d(amount).gt(0) ? d(toAmount).div(d(amount)).toFixed(8) : null
    const row = {
      id,
      type,
      date,
      amount: toDb(amount),
      currency,
      sub_account_id: subId,
      category_id: type === 'transfer' ? null : categoryId,
      tags: tagList,
      notes: notes.trim() || null,
      payee: payee.trim() || null,
      to_sub_account_id: type === 'transfer' ? toSubId : null,
      to_amount: type === 'transfer' ? toDb(crossCurrency ? toAmount : amount) : null,
      to_currency: type === 'transfer' ? toCurrency : null,
      rate_used: rateUsed,
      source: initial?.source ?? 'manual',
      source_id: initial?.source_id ?? null,
    }
    prefs.remember({
      lastSubAccountId: subId,
      lastCurrency: currency,
      ...(type === 'expense' ? { lastExpenseCategoryId: categoryId } : type === 'income' ? { lastIncomeCategoryId: categoryId } : {}),
    })
    await save.mutateAsync({ row, previous: initial ?? null })
    onSaved?.()
    onClose()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={initial ? 'Edit transaction' : type === 'income' ? 'Add income' : type === 'transfer' ? (payCard ? 'Pay card' : 'Transfer') : 'Add expense'}
        footer={
          <div className="flex gap-3">
            {initial ? (
              <Button variant="secondary" size="lg" onClick={() => setConfirm(true)} aria-label="Delete">
                <Trash2 className="text-negative h-4 w-4" />
              </Button>
            ) : null}
            <Button full size="lg" onClick={submit} loading={save.isPending} disabled={!valid}>
              {initial ? 'Save changes' : 'Save'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {!initial?.source || initial.source === 'manual' ? (
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
                { value: 'transfer', label: 'Transfer' },
              ]}
            />
          ) : initial.source === 'detached_transfer' ? (
            <p className="bg-surface-2 text-muted rounded-xl px-3 py-2 text-xs">
              Money moved to or from a balance you deleted. It is kept so this balance stays correct, and is not counted as income or spending.
            </p>
          ) : (
            <p className="bg-surface-2 text-muted rounded-xl px-3 py-2 text-xs">
              Created automatically from a{' '}
              {initial.source === 'debt'
                ? 'debt payment'
                : initial.source === 'certificate'
                  ? 'certificate payout'
                  : initial.source === 'yield'
                    ? 'Cloud interest posting'
                    : initial.source === 'investment'
                      ? 'investment sale'
                      : 'recurring rule'}
              .
            </p>
          )}

          {planOfTx ? (
            <p className="bg-surface-2 text-muted rounded-xl px-3 py-2 text-xs">
              Part of the installment plan "{planOfTx.description}" ({planOfTx.months} months). Its amount, card and date are managed by the plan on the card's
              page.
            </p>
          ) : null}
          <AmountInput value={amount} onChange={setAmount} currency={currency} currencies={currencies} disabled={linked} />

          <Field label={type === 'transfer' ? 'From' : 'Account'}>
            <Select value={subId} onChange={(e) => setSubId(e.target.value)} disabled={linked}>
              {!activeSubs.length ? <option value="">No accounts yet</option> : null}
              <BalanceOptions subs={activeSubs} />
            </Select>
          </Field>

          {spendCard && spendCard.usage.available ? (
            <p className={`-mt-2 text-xs ${overLimit ? 'text-negative font-medium' : 'text-muted'}`}>
              {!initial && type === 'expense' ? (
                <button
                  type="button"
                  className="text-accent float-right font-medium"
                  onClick={() => {
                    setInstallments({ cardAccountId: spendCard.account.id, amount, description: payee, categoryId, date })
                    onClose()
                  }}
                >
                  Pay in installments
                </button>
              ) : null}
              {overLimit ? 'Over the credit limit: ' : 'Available credit: '}
              <Amount value={spendCard.usage.available} currency={spendCard.currency} decimals={0} />
              {spendCard.usage.limit ? (
                <>
                  {' '}
                  of <Amount value={spendCard.usage.limit} currency={spendCard.currency} decimals={0} />
                </>
              ) : null}
            </p>
          ) : null}

          {type === 'transfer' ? (
            <>
              <Field label={payCard ? 'Card' : 'To'}>
                <Select value={toSubId} onChange={(e) => setToSubId(e.target.value)}>
                  <BalanceOptions subs={activeSubs.filter((s) => s.id !== subId)} />
                </Select>
              </Field>
              {payCard?.statement && payCard.statement.status !== 'nothing' ? (
                <p className="text-muted -mt-2 text-xs">
                  {payCard.statement.status === 'paid' ? (
                    <>
                      Statement of {formatDate(payCard.statement.statementDate, 'd MMM')} is paid. Owed now:{' '}
                      <Amount value={payCard.usage.owed} currency={payCard.currency} decimals={0} />
                    </>
                  ) : (
                    <>
                      Left on the statement: <Amount value={payCard.statement.remaining} currency={payCard.currency} decimals={0} /> · due{' '}
                      {formatDate(payCard.statement.dueDate, 'd MMM')}
                      {payCard.statement.minimumLeft.gt(0) ? (
                        <>
                          {' '}
                          · minimum <Amount value={payCard.statement.minimumLeft} currency={payCard.currency} decimals={0} />
                        </>
                      ) : null}
                    </>
                  )}
                </p>
              ) : payCard ? (
                <p className="text-muted -mt-2 text-xs">
                  Owed now: <Amount value={payCard.usage.owed} currency={payCard.currency} decimals={0} />
                </p>
              ) : null}
              {crossCurrency ? (
                <Field
                  label={`Amount received (${toCurrency})`}
                  hint={
                    d(amount).gt(0) && d(toAmount).gt(0)
                      ? `Rate used: 1 ${currency} = ${d(toAmount).div(d(amount)).toFixed(4)} ${toCurrency}`
                      : 'Suggested from today’s rate; edit to match what the bank gave you'
                  }
                >
                  <AmountInput value={toAmount} onChange={setToAmount} currency={toCurrency} currencies={currencies} />
                </Field>
              ) : null}
            </>
          ) : (
            <Field label="Category" group>
              <CategoryPicker
                kind={type}
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id)
                  setCategoryTouched(true)
                }}
              />
            </Field>
          )}

          {type === 'transfer' ? (
            // a transfer between my own accounts has no payee
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={linked} />
            </Field>
          ) : (
            <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 min-[360px]:gap-4">
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={linked} />
              </Field>
              <Field label={type === 'income' ? 'From' : 'Paid to'}>
                <Input
                  value={payee}
                  list={`payees-${type}`}
                  autoComplete="off"
                  onChange={(e) => {
                    const v = e.target.value
                    setPayee(v)
                    // a name used before brings its usual category, unless one was picked already
                    const remembered = payeeCategory.get(`${type}:${v.trim().toLowerCase()}`)
                    if (remembered && !categoryTouched && !initial && categories?.some((c) => c.id === remembered && !c.is_archived)) setCategoryId(remembered)
                  }}
                  placeholder={type === 'income' ? 'e.g. venue or client' : 'Optional'}
                />
                <datalist id={`payees-${type}`}>
                  {payeeSuggestions.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
            </div>
          )}
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. travel, work" />
          </Field>
        </div>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Delete this transaction?"
          message="The account balance will be adjusted. You can undo for a few seconds."
          onConfirm={() => {
            if (initial) remove(initial)
            onClose()
          }}
        />
      </Sheet>
      {/* outside the form's sheet, so it stays open after the form closes */}
      <InstallmentPurchaseSheet open={installments !== null} onClose={() => setInstallments(null)} preset={installments ?? undefined} />
    </>
  )
}
