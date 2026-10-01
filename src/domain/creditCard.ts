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

/** The statement before `statementDate`. */
export function previousStatementDate(statementDate: string, statementDay: number): string {
  const [y, m] = parts(statementDate)
  return onDay(y, m - 1, statementDay)
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
export function cardStatement(input: {
  balance: NumericInput
  subId: string
  statementDay: number
  dueDay: number
  minPct?: NumericInput | null
  activity: CardTx[]
  today: string
  /** installment-plan amounts not billed yet at the statement date (owed, but not due on this statement) */
  unbilledAtStatement?: NumericInput
}): CardStatement {
  const statementDate = lastStatementDate(input.today, input.statementDay)
  const dueDate = dueDateAfter(statementDate, input.dueDay)
  let paid = d(0)
  let newSpending = d(0)
  let delta = d(0)
  for (const t of input.activity) {
    if (t.date <= statementDate) continue
    const e = effectOn(t, input.subId)
    if (e.isZero()) continue
    // the stored balance already includes everything dated after the statement, future-dated items
    // too: take them all out to find what was owed at the statement
    delta = delta.plus(e)
    // but a payment or purchase dated in the future hasn't happened yet
    if (t.date > input.today) continue
    if (e.gt(0)) paid = paid.plus(e)
    else newSpending = newSpending.plus(e.neg())
  }
  const balanceAtStatement = d(input.balance).minus(delta)
  // owed at the statement, minus future installments of installment plans (not billed yet)
  const statementBalance = Decimal.max(0, balanceAtStatement.neg().minus(d(input.unbilledAtStatement ?? 0)))
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

// ---------------------------------------------------------------------------------------------
// Installment plans: a purchase paid over several statements
// ---------------------------------------------------------------------------------------------

export interface InstallmentPlanLike {
  principal: NumericInput
  fees: NumericInput
  months: number
  purchase_date: string
  first_billing_date: string
  closed_at?: string | null
}

/** The statement a purchase is first billed on: the statement day on or after the purchase. */
export function firstBillingDate(purchaseDate: string, statementDay: number): string {
  const last = lastStatementDate(purchaseDate, statementDay)
  return last === purchaseDate ? purchaseDate : nextStatementDate(last, statementDay)
}

export interface Installment {
  n: number
  date: string
  amount: Decimal
}

/** Equal installments (to the piastre; the last one takes the rounding), one per statement. */
export function installmentSchedule(plan: InstallmentPlanLike, statementDay: number): Installment[] {
  const total = d(plan.principal).plus(d(plan.fees))
  const each = total.div(plan.months).toDecimalPlaces(2, Decimal.ROUND_DOWN)
  const out: Installment[] = []
  // worked out from the card's current statement day, so changing that day moves the whole schedule
  // instead of billing one installment on the old day and the next on the new one
  let date = statementDay ? firstBillingDate(plan.purchase_date, statementDay) : plan.first_billing_date
  for (let n = 1; n <= plan.months; n++) {
    out.push({ n, date, amount: n < plan.months ? each : total.minus(each.times(plan.months - 1)) })
    date = nextStatementDate(date, statementDay)
  }
  return out
}

export interface PlanProgress {
  total: Decimal
  monthly: Decimal
  billedCount: number
  billed: Decimal
  /** owed but not billed yet */
  unbilled: Decimal
  next: Installment | null
  endDate: string
  status: 'active' | 'done' | 'settled'
}

/** Where a plan stands on a given date. */
export function planProgress(plan: InstallmentPlanLike, statementDay: number, onDate: string): PlanProgress {
  const schedule = installmentSchedule(plan, statementDay)
  const total = d(plan.principal).plus(d(plan.fees))
  const endDate = schedule[schedule.length - 1]!.date
  const monthly = schedule[0]!.amount
  if (onDate < plan.purchase_date) return { total, monthly, billedCount: 0, billed: d(0), unbilled: d(0), next: schedule[0]!, endDate, status: 'active' }
  if (plan.closed_at && onDate >= plan.closed_at) return { total, monthly, billedCount: plan.months, billed: total, unbilled: d(0), next: null, endDate: plan.closed_at, status: 'settled' }
  const billedItems = schedule.filter((i) => i.date <= onDate)
  const billed = billedItems.reduce((a, i) => a.plus(i.amount), d(0))
  const next = schedule.find((i) => i.date > onDate) ?? null
  return { total, monthly, billedCount: billedItems.length, billed, unbilled: total.minus(billed), next, endDate, status: next ? 'active' : 'done' }
}

/** Sum of what the plans still have to bill after `onDate` (owed on the card, not yet due). */
export function unbilledInstallments(plans: InstallmentPlanLike[], statementDay: number, onDate: string): Decimal {
  return plans.reduce((a, p) => a.plus(planProgress(p, statementDay, onDate).unbilled), d(0))
}

/** Installments billed exactly on a statement (what the plans added to it). */
export function installmentsOnStatement(plans: InstallmentPlanLike[], statementDay: number, statementDate: string): Decimal {
  return plans.reduce((a, p) => {
    if (p.closed_at && p.closed_at <= statementDate) {
      // settled early since the previous statement: everything still owed lands on this one
      const prev = previousStatementDate(statementDate, statementDay)
      if (p.closed_at <= prev) return a
      return a.plus(p.purchase_date > prev ? d(p.principal).plus(d(p.fees)) : planProgress({ ...p, closed_at: null }, statementDay, prev).unbilled)
    }
    const item = installmentSchedule(p, statementDay).find((i) => i.date === statementDate)
    return item ? a.plus(item.amount) : a
  }, d(0))
}
