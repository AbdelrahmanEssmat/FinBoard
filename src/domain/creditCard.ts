/**
 * Credit cards, as pure functions.
 *
 * A card is an account whose balances go below zero by what you owe: spending on it is an expense
 * on the card, paying it is a transfer into it, a refund is income on it. From the card's settings
 * (credit limit, statement day, due day, minimum %) and its activity since the last statement we
 * work out the statement balance, what has been paid, what is left, the minimum and the due date.
 */
import { d, Decimal, type NumericInput } from '@/domain/money'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate()
/** The given day in month m of year y, pulled back to the month's last day when it doesn't exist (31 → 30 Sep). */
function onDay(y: number, m: number, day: number): string {
  const mm = ((m - 1 + 1200) % 12) + 1
  const yy = y + Math.floor((m - 1) / 12)
  return iso(yy, mm, Math.min(day, daysIn(yy, mm)))
}
const parts = (isoDate: string) => isoDate.split('-').map(Number) as [number, number, number]

/** The most recent statement date on or before today. */
export function lastStatementDate(today: string, statementDay: number): string {
  const [y, m] = parts(today)
  const thisMonth = onDay(y, m, statementDay)
  return thisMonth <= today ? thisMonth : onDay(y, m - 1, statementDay)
}

/** The statement after `statementDate`. */
export function nextStatementDate(statementDate: string, statementDay: number): string {
  const [y, m] = parts(statementDate)
  return onDay(y, m + 1, statementDay)
}

/** The first `dueDay` after the statement date (the same month if it comes later, else the next). */
export function dueDateAfter(statementDate: string, dueDay: number): string {
  const [y, m] = parts(statementDate)
  const same = onDay(y, m, dueDay)
  return same > statementDate ? same : onDay(y, m + 1, dueDay)
}

export function daysBetweenIso(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000)
}

export interface CardTx {
  type: 'income' | 'expense' | 'transfer'
  date: string
  amount: NumericInput
  sub_account_id: string
  to_sub_account_id?: string | null
  to_amount?: NumericInput | null
}

/** What a transaction did to one balance: + money in (payment, refund), − money out (spending). */
export function effectOn(t: CardTx, subId: string): Decimal {
  let e = d(0)
  if (t.sub_account_id === subId) {
    if (t.type === 'income') e = e.plus(d(t.amount))
    else e = e.minus(d(t.amount)) // expense, or a transfer out of the card (cash advance)
  }
  if (t.type === 'transfer' && t.to_sub_account_id === subId) e = e.plus(d(t.to_amount ?? t.amount))
  return e
}

export type StatementStatus = 'nothing' | 'paid' | 'due' | 'overdue'

export interface CardStatement {
  statementDate: string
  dueDate: string
  nextStatementDate: string
  /** owed when the statement was issued */
  statementBalance: Decimal
  /** payments and refunds since the statement */
  paid: Decimal
  /** still to pay before the due date to clear the statement */
  remaining: Decimal
  /** the minimum payment for this statement, and how much of it is still unpaid */
  minimum: Decimal
  minimumLeft: Decimal
  /** spending since the statement (goes on the next one) */
  newSpending: Decimal
  status: StatementStatus
  /** days until the due date (negative once overdue) */
  daysLeft: number
}

/** The current statement of one card balance (normally the card's main currency). */
export function cardStatement(input: { balance: NumericInput; subId: string; statementDay: number; dueDay: number; minPct?: NumericInput | null; activity: CardTx[]; today: string }): CardStatement {
  const statementDate = lastStatementDate(input.today, input.statementDay)
  const dueDate = dueDateAfter(statementDate, input.dueDay)
  let paid = d(0)
  let newSpending = d(0)
  let delta = d(0)
  for (const t of input.activity) {
    if (t.date <= statementDate || t.date > input.today) continue
    const e = effectOn(t, input.subId)
    if (e.isZero()) continue
    delta = delta.plus(e)
    if (e.gt(0)) paid = paid.plus(e)
    else newSpending = newSpending.plus(e.neg())
  }
  const balanceAtStatement = d(input.balance).minus(delta)
  const statementBalance = Decimal.max(0, balanceAtStatement.neg())
  const remaining = Decimal.max(0, statementBalance.minus(paid))
  const minimum = statementBalance.times(d(input.minPct ?? 0)).div(100).toDecimalPlaces(2)
  const minimumLeft = Decimal.max(0, Decimal.min(remaining, minimum.minus(paid)))
  const daysLeft = daysBetweenIso(input.today, dueDate)
  const status: StatementStatus = statementBalance.isZero() ? 'nothing' : remaining.isZero() ? 'paid' : daysLeft < 0 ? 'overdue' : 'due'
  return { statementDate, dueDate, nextStatementDate: nextStatementDate(statementDate, input.statementDay), statementBalance, paid, remaining, minimum, minimumLeft, newSpending, status, daysLeft }
}

export interface CardUsage {
  /** owed across the card's balances, in the card's main currency (0 when in credit) */
  owed: Decimal
  /** money on the card beyond zero (overpaid / refunds), in the main currency */
  credit: Decimal
  limit: Decimal | null
  /** limit − owed (negative when over the limit) */
  available: Decimal | null
  /** owed / limit in % */
  utilization: number | null
}

/** Owed, available credit and utilisation. `balances` are already converted to the main currency. */
export function cardUsage(balances: Decimal[], limit: NumericInput | null | undefined): CardUsage {
  const net = balances.reduce((a, b) => a.plus(b), d(0))
  const owed = Decimal.max(0, net.neg())
  const credit = Decimal.max(0, net)
  const lim = limit !== null && limit !== undefined && d(limit).gt(0) ? d(limit) : null
  return { owed, credit, limit: lim, available: lim ? lim.minus(owed) : null, utilization: lim ? owed.div(lim).times(100).toNumber() : null }
}

/** Plain-language state of a card's payment, for rows and badges. */
export function statementLabel(s: CardStatement): string {
  if (s.status === 'nothing') return 'Nothing to pay'
  if (s.status === 'paid') return 'Statement paid'
  if (s.status === 'overdue') return `Overdue by ${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'}`
  if (s.daysLeft === 0) return 'Due today'
  return `Due in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`
}
