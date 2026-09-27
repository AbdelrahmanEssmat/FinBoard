import { useMemo } from 'react'
import { useAccounts, useCardActivity, useSubAccounts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d, Decimal } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'
import { cardStatement, cardUsage, lastStatementDate, type CardStatement, type CardUsage } from '@/domain/creditCard'
import type { Account, SubAccount } from '@/api/database.types'

export interface CreditCardView {
  account: Account
  /** the balance the limit and statement are in (the card's first currency) */
  primary: SubAccount | null
  subs: SubAccount[]
  currency: string
  usage: CardUsage
  /** null until a statement day and due day are set on the card */
  statement: CardStatement | null
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

  const list = useMemo<CreditCardView[]>(() => {
    return cards.map((account) => {
      const mine = cardSubs.filter((s) => s.account_id === account.id)
      const primary = mine[0] ?? null
      const currency = primary?.currency ?? 'EGP'
      const converted = mine.map((s) => between(s.balance, s.currency, currency) ?? d(0))
      const usage = cardUsage(converted, account.credit_limit)
      const statement =
        primary && account.statement_day && account.due_day
          ? cardStatement({ balance: primary.balance, subId: primary.id, statementDay: account.statement_day, dueDay: account.due_day, minPct: account.min_payment_pct, activity: activity ?? [], today })
          : null
      return { account, primary, subs: mine, currency, usage, statement }
    })
  }, [cards, cardSubs, activity, between, today])

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
