import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Card, Divider } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import type { DebtActivity } from '@/domain/debts'

/** Money lent, borrowed and repaid in the period. It moves balances, but it isn't income or spending. */
export function DebtsCard({ activity, display }: { activity: DebtActivity | null; display: string }) {
  const navigate = useNavigate()
  if (!activity?.any) return null
  const rows = [
    { key: 'lent', label: 'Lent', hint: 'People now owe you this', value: activity.lent, out: true },
    { key: 'back', label: 'Got back', hint: 'Repayments you received', value: activity.receivedBack, out: false },
    { key: 'borrowed', label: 'Borrowed', hint: 'You now owe this', value: activity.borrowed, out: false },
    { key: 'paid', label: 'Paid back', hint: 'Repayments you made', value: activity.paidBack, out: true },
  ].filter((r) => r.value.gt(0))
  return (
    <Section
      title="Debts"
      action={
        <button onClick={() => navigate('/debts')} className="-my-1.5 -mr-2 flex min-h-11 items-center px-2 text-xs font-medium text-accent">
          Open debts
        </button>
      }
    >
      <Card className="overflow-hidden">
        {rows.map((r, i) => {
          const Icon = r.out ? ArrowUpRight : ArrowDownLeft
          return (
            <div key={r.key}>
              {i > 0 ? <Divider /> : null}
              <div className="flex items-center gap-3 px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{r.label}</div>
                  <div className="text-xs text-muted">{r.hint}</div>
                </div>
                <Amount value={r.value} currency={display} className="shrink-0 text-sm font-semibold" />
              </div>
            </div>
          )
        })}
        <Divider />
        <p className="px-5 py-3 text-xs text-muted">Lending, borrowing and repayments move your balances but aren’t income or spending, so they’re not in the totals above.</p>
      </Card>
    </Section>
  )
}
