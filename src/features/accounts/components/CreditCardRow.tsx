import { createElement, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { Amount } from '@/components/shared'
import { statementLabel } from '@/domain/creditCard'
import { iconFor } from '@/utils/icons'
import { byId, cn } from '@/utils'
import { useAccounts } from '@/api/queries'
import { cardName } from '@/features/accounts/accountLabels'
import type { CreditCardView } from '@/hooks/useCreditCards'

/** Utilisation colour: calm under 30%, warning to 70%, red above. */
export const utilizationColor = (pct: number | null) =>
  pct === null ? 'var(--color-accent)' : pct > 70 ? 'var(--color-negative)' : pct > 30 ? 'var(--color-warning)' : 'var(--color-positive)'

/** A card in the accounts list: what it owes, how much of the limit is used, and the payment status. */
export function CreditCardRow({ card, onClick }: { card: CreditCardView; onClick: () => void }) {
  const { account, usage, statement, currency } = card
  const status = statement ? statementLabel(statement) : null
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  return (
    <button onClick={onClick} className="hover:bg-surface-2 active:bg-surface-2 flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: account.color + '22', color: account.color }}>
        {createElement(iconFor(account.icon), { className: 'h-[18px] w-[18px]' })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-[15px] font-medium">{cardName(account, accMap)}</span>
          <span className="shrink-0 text-right">
            {usage.owed.gt(0) ? (
              <Amount value={usage.owed.neg()} currency={currency} className="text-negative font-semibold" />
            ) : (
              <span className="text-positive text-sm font-medium">Nothing owed</span>
            )}
          </span>
        </span>
        {usage.limit ? (
          <span className="bg-surface-2 mt-2 block h-1.5 overflow-hidden rounded-full">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, usage.utilization ?? 0)}%`, background: utilizationColor(usage.utilization) }}
            />
          </span>
        ) : null}
        <span className="text-muted mt-1.5 flex items-center justify-between gap-3 text-[12px]">
          <span className="truncate">
            {usage.limit ? (
              <>
                <Amount value={usage.available ?? 0} currency={currency} decimals={0} /> available · {Math.round(usage.utilization ?? 0)}% used
              </>
            ) : (
              'No limit set'
            )}
          </span>
          {status ? (
            <span
              className={cn(
                'shrink-0 font-medium',
                statement?.status === 'overdue' ? 'text-negative' : statement?.status === 'due' && statement.daysLeft <= 5 ? 'text-warning' : '',
              )}
            >
              {status}
            </span>
          ) : null}
        </span>
      </span>
      <ChevronRight className="text-faint -mr-1 h-4 w-4 shrink-0" />
    </button>
  )
}
