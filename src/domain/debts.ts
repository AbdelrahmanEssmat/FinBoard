/**
 * Money lent, borrowed and repaid over a period. None of it is income or spending (it is excluded
 * from those totals everywhere). A debt is a record: it changes your accounts, and so net worth, only
 * when it is repaid into or out of an account (or when the money was recorded moving as it was lent or
 * borrowed). The home page and Reports show this activity on its own.
 */
import { addMonths, format, parseISO } from 'date-fns'
import { d, type Decimal, type NumericInput } from '@/domain/money'
import type { DateRange, ToBase } from '@/domain/insights'

export interface DebtRecordLike {
  id: string
  direction: 'i_owe' | 'owed_to_me'
  amount: NumericInput
  currency: string
  /** the day the money was lent or borrowed */
  date: string
  /** the money movement saved with the debt (money that left or came into an account), if any */
  transaction_id: string | null
}

export interface DebtPaymentRecordLike {
  debt_id: string
  amount: NumericInput
  date: string
  /** the repayment's money movement, if it was recorded in an account */
  transaction_id: string | null
}

export interface DebtActivity {
  /** new money people owe you (lent) */
  lent: Decimal
  /** repayments people made to you */
  receivedBack: Decimal
  /** new money you owe (borrowed) */
  borrowed: Decimal
  /** repayments you made */
  paidBack: Decimal
  /**
   * How much these debts changed your accounts, and so net worth: repayments recorded in an account,
   * and money recorded as leaving or coming in when a debt was saved. Positive = more money in your
   * accounts. (Open debts themselves aren't part of net worth.)
   */
  balanceEffect: Decimal
  /** anything lent, borrowed or repaid in the period */
  any: boolean
}

/** What was lent, borrowed and repaid between range.from and range.to (both included), each at its own day's rate. */
export function debtActivity(debts: DebtRecordLike[], payments: DebtPaymentRecordLike[], range: DateRange, toBase: ToBase): DebtActivity {
  let lent = d(0)
  let receivedBack = d(0)
  let borrowed = d(0)
  let paidBack = d(0)
  let balanceEffect = d(0)
  const inRange = (date: string) => date >= range.from && date <= range.to
  const byId = new Map(debts.map((x) => [x.id, x]))
  for (const x of debts) {
    if (!inRange(x.date)) continue
    const v = toBase(x.amount, x.currency, x.date)
    if (x.direction === 'owed_to_me') lent = lent.plus(v)
    else borrowed = borrowed.plus(v)
    // the money left an account as it was lent (or came in as it was borrowed)
    if (x.transaction_id) balanceEffect = x.direction === 'owed_to_me' ? balanceEffect.minus(v) : balanceEffect.plus(v)
  }
  for (const p of payments) {
    const x = byId.get(p.debt_id)
    if (!x || !inRange(p.date)) continue
    const v = toBase(p.amount, x.currency, p.date)
    if (x.direction === 'owed_to_me') receivedBack = receivedBack.plus(v)
    else paidBack = paidBack.plus(v)
    // a repayment recorded in an account: money in when they repay you, out when you repay them
    if (p.transaction_id) balanceEffect = x.direction === 'owed_to_me' ? balanceEffect.plus(v) : balanceEffect.minus(v)
  }
  const any = [lent, receivedBack, borrowed, paidBack].some((v) => !v.isZero())
  return { lent, receivedBack, borrowed, paidBack, balanceEffect, any }
}

/**
 * The first date of a monthly debt on or after `from`: the same day of the month as `start`, counted
 * from `start` the way the database does (31 Jan, 28 Feb, 31 Mar ...).
 */
export function nextMonthlyDate(start: string, from: string): string {
  const first = parseISO(start)
  for (let k = 0; k < 1200; k++) {
    const dt = format(addMonths(first, k), 'yyyy-MM-dd')
    if (dt >= from) return dt
  }
  return from
}

/** What a debt transaction was, for lists: lending, borrowing, or a repayment either way. */
export function debtKind(t: { type: string }, debt: Pick<DebtRecordLike, 'direction'> | undefined): string {
  if (!debt) return 'Debt'
  if (debt.direction === 'owed_to_me') return t.type === 'expense' ? 'Lent' : 'Repaid to you'
  return t.type === 'income' ? 'Borrowed' : 'You repaid'
}
