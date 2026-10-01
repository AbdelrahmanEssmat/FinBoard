import { useMemo } from 'react'
import { useAccounts, useCardActivity, useInstallmentPlans, useSubAccounts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d, Decimal } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'
import { cardStatement, cardUsage, installmentsOnStatement, lastStatementDate, planProgress, unbilledInstallments, type CardStatement, type CardUsage, type PlanProgress } from '@/domain/creditCard'
import type { Account, CardInstallmentPlan, SubAccount } from '@/api/database.types'

export interface CreditCardView {
  account: Account
  /** the balance the limit and statement are in (the card's first currency) */
  primary: SubAccount | null
  subs: SubAccount[]
  currency: string
  usage: CardUsage
  /** null until a statement day and due day are set on the card */
  statement: CardStatement | null
  /** installment plans on this card, with where each stands today */
  plans: { plan: CardInstallmentPlan; progress: PlanProgress | null }[]
  /** owed on the card but billed on future statements (installments), in the card's currency */
  unbilled: Decimal
  /** installments billed on the current statement */
  installmentsThisStatement: Decimal
}

/** Every active credit card with what's owed, available credit and the current statement. */
export function useCreditCards() {
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const { between, toDisplayOrZero, display } = useConvert()
  const today = todayIso()

  const cards = useMemo(() => (accounts ?? []).filter((a) => a.type === 'credit_card' && !a.is_archived), [accounts])
  const cardSubs = useMemo(() => (subs ?? []).filter((s) => !s.is_archived && cards.some((c) => c.id === s.account_id)), [subs, cards])
  // activity since the earliest of the cards' last statements (or ~6 weeks when none is set)
  const from = useMemo(() => {
    const starts = cards.filter((c) => c.statement_day).map((c) => lastStatementDate(today, c.statement_day!))
    return starts.length ? starts.sort()[0]! : addDaysIso(today, -45)
  }, [cards, today])
  const { data: activity, isLoading: activityLoading } = useCardActivity(cardSubs.map((s) => s.id), from)
  const { data: allPlans } = useInstallmentPlans()

  const list = useMemo<CreditCardView[]>(() => {
    return cards.map((account) => {
      const mine = cardSubs.filter((s) => s.account_id === account.id)
      const primary = mine[0] ?? null
      const currency = primary?.currency ?? 'EGP'
      const converted = mine.map((s) => between(s.balance, s.currency, currency) ?? d(0))
      const usage = cardUsage(converted, account.credit_limit)
      // plans on the card's main balance (the one the statement is worked out for)
      const cardPlans = (allPlans ?? []).filter((p) => p.account_id === account.id)
      const onPrimary = cardPlans.filter((p) => p.sub_account_id === primary?.id)
      const sd = account.statement_day
      const statementDate = sd ? lastStatementDate(today, sd) : null
      const statement =
        primary && sd && account.due_day
          ? cardStatement({
              balance: primary.balance,
              subId: primary.id,
              statementDay: sd,
              dueDay: account.due_day,
              minPct: account.min_payment_pct,
              activity: activity ?? [],
              today,
              unbilledAtStatement: unbilledInstallments(onPrimary, sd, statementDate!),
            })
          : null
      // an installment purchase made since the statement is in its spending in full, but only its first
      // installment goes on the next statement
      const shownStatement =
        statement && sd
          ? {
              ...statement,
              newSpending: Decimal.max(
                0,
                statement.newSpending.minus(
                  unbilledInstallments(
                    onPrimary.filter((p) => p.purchase_date > statement.statementDate && p.purchase_date <= today),
                    sd,
                    statement.nextStatementDate,
                  ),
                ),
              ),
            }
          : statement
      return {
        account,
        primary,
        subs: mine,
        currency,
        usage,
        statement: shownStatement,
        plans: cardPlans.map((plan) => ({ plan, progress: sd ? planProgress(plan, sd, today) : null })),
        unbilled: sd ? unbilledInstallments(onPrimary, sd, today) : d(0),
        installmentsThisStatement: sd && statementDate ? installmentsOnStatement(onPrimary, sd, statementDate) : d(0),
      }
    })
  }, [cards, cardSubs, activity, allPlans, between, today])

  const totals = useMemo(() => {
    let owed = d(0)
    let available: Decimal | null = null
    for (const c of list) {
      owed = owed.plus(toDisplayOrZero(c.usage.owed, c.currency))
      if (c.usage.available) available = (available ?? d(0)).plus(toDisplayOrZero(c.usage.available, c.currency))
    }
    return { owed, available, display }
  }, [list, toDisplayOrZero, display])

  /** the card whose payment needs attention first (overdue, then soonest due with money left) */
  const mostUrgent = useMemo(
    () =>
      list
        .filter((c) => c.statement && (c.statement.status === 'due' || c.statement.status === 'overdue'))
        .sort((a, b) => a.statement!.daysLeft - b.statement!.daysLeft)[0] ?? null,
    [list],
  )

  return { cards: list, totals, mostUrgent, isLoading: activityLoading && cardSubs.length > 0 }
}
