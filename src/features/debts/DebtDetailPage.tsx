import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Amount, ListRow, NotFound, PageHeader, PageSkeleton, SectionTitle } from '@/components/shared'
import { Button, Card, ConfirmDialog, Divider, Pill, ProgressBar } from '@/components/ui'
import { useUndoableDelete } from '@/api/mutations'
import { useAccounts, useSubAccounts } from '@/api/queries'
import { balanceLabel } from '@/features/accounts/accountLabels'
import { byId } from '@/utils'
import { formatDate } from '@/domain/format'
import { DebtForm } from '@/features/debts/components/DebtForm'
import { DebtPaymentForm } from '@/features/debts/components/DebtPaymentForm'
import { useDebtViews } from '@/features/debts/useDebtViews'
import type { DebtPayment } from '@/api/database.types'

export default function DebtDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { list, isLoading } = useDebtViews()
  const debt = list.find((x) => x.id === id)
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [confirmPayment, setConfirmPayment] = useState<DebtPayment | null>(null)
  const deleteDebt = useUndoableDelete('debts', { invalidate: ['debt_payments', 'transactions', 'sub_accounts'], label: 'Debt' })
  const deletePayment = useUndoableDelete('debt_payments', { invalidate: ['debts', 'transactions', 'sub_accounts'], label: 'Payment' })
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const subMap = useMemo(() => byId(subs), [subs])
  /** "NBE · EGP" for the balance some money moved in, if it's known */
  const balanceName = (subId: string | null) => {
    const sub = subId ? subMap.get(subId) : undefined
    return sub ? balanceLabel(sub, accMap) : null
  }

  if (!debt) return isLoading && !list.length ? <PageSkeleton back /> : <NotFound title="Debt not found" />
  const positive = debt.direction === 'owed_to_me'

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title={debt.contact?.name ?? 'Debt'}
        subtitle={positive ? 'Owes you' : 'You owe'}
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEdit(true)}>
              <Pencil className="h-5 w-5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setConfirm(true)}>
              <Trash2 className="h-5 w-5 text-negative" />
            </Button>
          </div>
        }
      />

      <Card padded className="mb-8">
        <div className="flex items-end justify-between">
          <div className="min-w-0">
            <div className="text-xs text-muted">Remaining</div>
            <Amount value={debt.remaining} currency={debt.currency} size="xl" className={positive ? 'text-positive' : 'text-negative'} />
          </div>
          {debt.status === 'settled' ? (
            <Pill tone="positive">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Settled
            </Pill>
          ) : debt.overdue ? (
            <Pill tone="negative">Overdue</Pill>
          ) : null}
        </div>
        <ProgressBar className="mt-4" value={debt.percent} color={positive ? 'var(--color-positive)' : 'var(--color-negative)'} />
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>
            Paid <Amount value={debt.paid} currency={debt.currency} size="sm" />
          </span>
          <span>
            of <Amount value={debt.amount} currency={debt.currency} size="sm" />
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted">Date</dt>
          <dd>{formatDate(debt.date)}</dd>
          <dt className="text-muted">Money</dt>
          <dd className="min-w-0">
            {debt.transaction_id ? (
              <span className="break-words">
                {positive ? 'Left ' : 'Came into '}
                {balanceName(debt.sub_account_id) ?? 'an account'}
              </span>
            ) : (
              // saved without its money movement: it counts in net worth, but no balance changed
              <button onClick={() => setEdit(true)} className="-my-1 text-left text-accent">
                Not linked to an account · Link
              </button>
            )}
          </dd>
          {debt.due_date ? (
            <>
              <dt className="text-muted">Due</dt>
              <dd>{formatDate(debt.due_date)}</dd>
            </>
          ) : null}
          {debt.reason ? (
            <>
              <dt className="text-muted">Reason</dt>
              <dd>{debt.reason}</dd>
            </>
          ) : null}
          {debt.notes ? (
            <>
              <dt className="text-muted">Notes</dt>
              <dd className="whitespace-pre-wrap">{debt.notes}</dd>
            </>
          ) : null}
        </dl>
        {debt.status === 'open' ? (
          <Button full className="mt-4" onClick={() => setPay(true)}>
            <Plus className="h-4 w-4" /> {positive ? 'Record repayment' : 'Pay back'}
          </Button>
        ) : null}
      </Card>

      {debt.plan.length > 1 || debt.plan_count ? (
        <>
          <SectionTitle>Installment plan</SectionTitle>
          <Card className="mb-8 overflow-hidden">
            {debt.plan.map((p, i) => (
              <div key={p.index}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={`Installment ${p.index + 1}`}
                  subtitle={formatDate(p.dueDate)}
                  trailing={
                    <span className="flex items-center gap-2">
                      <Amount value={p.amount} currency={debt.currency} className="font-medium" />
                      <Pill tone={p.status === 'paid' ? 'positive' : p.status === 'overdue' ? 'negative' : p.status === 'due' ? 'warning' : 'neutral'}>
                        {p.status === 'paid' ? 'paid' : p.status === 'overdue' ? 'overdue' : p.status === 'due' ? 'due today' : p.paid.gt(0) ? 'partly paid' : 'upcoming'}
                      </Pill>
                    </span>
                  }
                />
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Payments</SectionTitle>
      <Card className="overflow-hidden">
        {debt.payments.map((p, i) => (
          <div key={p.id}>
            {i > 0 ? <Divider /> : null}
            <ListRow title={formatDate(p.date)} subtitle={p.notes ?? (p.transaction_id ? `${positive ? 'Into' : 'From'} ${balanceName(p.sub_account_id) ?? 'an account'}` : 'No account')} trailing={<Amount value={p.amount} currency={debt.currency} className="font-medium" />} onClick={() => setConfirmPayment(p)} />
          </div>
        ))}
        {!debt.payments.length ? <p className="p-5 text-sm text-muted">No payments yet.</p> : null}
      </Card>

      <DebtForm open={edit} onClose={() => setEdit(false)} direction={debt.direction} initial={debt} />
      <DebtPaymentForm open={pay} onClose={() => setPay(false)} debtId={debt.id} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this debt?"
        message="Its payments, and the account transactions they created (including the original borrow or lend), are removed too, so your balances go back to before this debt."
        onConfirm={() => {
          deleteDebt(debt)
          navigate('/debts')
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmPayment)}
        onClose={() => setConfirmPayment(null)}
        title="Delete this payment?"
        message="The linked account transaction will be removed as well."
        onConfirm={() => confirmPayment && deletePayment(confirmPayment)}
      />
    </div>
  )
}
