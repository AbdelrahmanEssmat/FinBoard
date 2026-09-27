import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { Amount } from '@/components/shared'
import { formatDate } from '@/domain/format'
import { statementLabel } from '@/domain/creditCard'
import { cn } from '@/utils'
import { TransactionForm } from '@/features/transactions/components/TransactionForm'
import { utilizationColor } from '@/features/accounts/components/CreditCardRow'
import type { CreditCardView } from '@/hooks/useCreditCards'

/** Top of a credit card's page: owed, available credit, the current statement and ways to pay it. */
export function CreditCardPanel({ card, onEdit }: { card: CreditCardView; onEdit: () => void }) {
  const { usage, statement: s, currency, primary, unbilled, installmentsThisStatement } = card
  const [pay, setPay] = useState<{ open: boolean; amount?: string }>({ open: false })
  const openPay = (amount?: string) => setPay({ open: true, amount })

  return (
    <div className="mb-8 space-y-4">
      <Card padded>
        <div className="text-xs text-muted">{usage.owed.gt(0) ? 'You owe' : usage.credit.gt(0) ? 'In credit' : 'You owe'}</div>
        <Amount value={usage.owed.gt(0) ? usage.owed : usage.credit} currency={currency} size="lg" className={usage.owed.gt(0) ? 'text-negative' : ''} />
        {unbilled.gt(0) ? (
          <div className="mt-1 text-xs text-muted">
            of which <Amount value={unbilled} currency={currency} decimals={0} className="font-medium text-text" /> is future installments, billed month by month
          </div>
        ) : null}
        {usage.limit ? (
          <>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, usage.utilization ?? 0)}%`, background: utilizationColor(usage.utilization) }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
              <span>
                <Amount value={usage.available ?? 0} currency={currency} decimals={0} className={cn('font-medium', usage.available?.lt(0) ? 'text-negative' : 'text-text')} /> available
              </span>
              <span>
                {Math.round(usage.utilization ?? 0)}% of <Amount value={usage.limit} currency={currency} decimals={0} />
              </span>
            </div>
            {(usage.utilization ?? 0) > 30 ? (
              <p className="mt-2 text-xs text-muted">{(usage.utilization ?? 0) > 100 ? 'Over the limit: new purchases may be declined and fees charged.' : 'Using more than 30% of the limit can cost more interest if you carry it over.'}</p>
            ) : null}
          </>
        ) : (
          <button onClick={onEdit} className="mt-2 text-xs font-medium text-accent">
            Set a credit limit to see available credit
          </button>
        )}
        {usage.owed.gt(0) && primary ? (
          <Button full className="mt-5" onClick={() => openPay(s && s.remaining.gt(0) ? s.remaining.toFixed(2) : usage.owed.toFixed(2))}>
            Pay card
          </Button>
        ) : null}
      </Card>

      {s ? (
        <Card padded>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-muted" /> Statement of {formatDate(s.statementDate, 'd MMM')}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                s.status === 'overdue' ? 'bg-negative-soft text-negative' : s.status === 'paid' || s.status === 'nothing' ? 'bg-positive-soft text-positive' : s.daysLeft <= 5 ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted',
              )}
            >
              {statementLabel(s)}
            </span>
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Statement balance" value={<Amount value={s.statementBalance} currency={currency} />} />
            {installmentsThisStatement.gt(0) ? <Row label="Installments on it" value={<Amount value={installmentsThisStatement} currency={currency} />} hint="included" /> : null}
            <Row label="Paid since" value={<Amount value={s.paid} currency={currency} className={s.paid.gt(0) ? 'text-positive' : ''} />} />
            <Row label="Left to pay" value={<Amount value={s.remaining} currency={currency} className="font-semibold" />} strong />
            {s.minimum.gt(0) ? <Row label="Minimum payment" value={<Amount value={s.minimumLeft.gt(0) ? s.minimumLeft : s.minimum} currency={currency} />} hint={s.minimumLeft.gt(0) ? 'still to pay' : 'covered'} /> : null}
            <Row label="Due date" value={formatDate(s.dueDate, 'EEE d MMM')} />
            <Row label="Spent since (next statement)" value={<Amount value={s.newSpending} currency={currency} />} />
            <Row label="Next statement" value={formatDate(s.nextStatementDate, 'd MMM')} />
          </dl>
          {s.remaining.gt(0) ? (
            <div className="mt-5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <Button variant="soft" onClick={() => openPay(s.remaining.toFixed(2))}>
                Pay statement
              </Button>
              {s.minimumLeft.gt(0) ? (
                <Button variant="secondary" onClick={() => openPay(s.minimumLeft.toFixed(2))}>
                  Pay minimum
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => openPay(usage.owed.toFixed(2))}>
                  Pay all owed
                </Button>
              )}
            </div>
          ) : null}
          {s.status === 'overdue' ? <p className="mt-3 text-xs text-negative">Paying after the due date usually means late fees and interest on the whole balance.</p> : null}
          {s.status === 'due' && s.remaining.gt(0) ? <p className="mt-3 text-xs text-muted">Pay the full statement by the due date to avoid interest.</p> : null}
        </Card>
      ) : (
        <Card padded className="text-sm text-muted">
          Set the statement and due days to track each statement, the minimum payment and the due date.{' '}
          <button onClick={onEdit} className="font-medium text-accent">
            Set them
          </button>
        </Card>
      )}

      <TransactionForm open={pay.open} onClose={() => setPay({ open: false })} defaultType="transfer" presetToSubAccountId={primary?.id} presetAmount={pay.amount} />
    </div>
  )
}

function Row({ label, value, hint, strong }: { label: string; value: React.ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'font-medium' : 'text-muted'}>
        {label}
        {hint ? <span className="ml-1.5 text-xs text-faint">{hint}</span> : null}
      </dt>
      <dd className="tnum shrink-0 text-right">{value}</dd>
    </div>
  )
}
