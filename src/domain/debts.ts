/**
 * Money lent, borrowed and repaid over a period. None of it is income or spending (it is excluded
 * from those totals everywhere), but it moves balances and changes what people owe, so the home page
 * and Reports show it on its own.
 */
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
   * How much these records changed net worth without any money moving in your accounts: a debt saved
   * without its money movement, or a repayment saved with "No account". Positive = net worth went up
   * (someone now owes you, or you were let off). With the money movement recorded the two sides
   * cancel out (the balance goes down by what you lent, what you are owed goes up by the same).
   */
  withoutMoney: Decimal
  /** anything lent, borrowed or repaid in the period */
  any: boolean
}

/** What was lent, borrowed and repaid between range.from and range.to (both included), each at its own day's rate. */
export function debtActivity(debts: DebtRecordLike[], payments: DebtPaymentRecordLike[], range: DateRange, toBase: ToBase): DebtActivity {
  let lent = d(0)
  let receivedBack = d(0)
  let borrowed = d(0)
  let paidBack = d(0)
  let withoutMoney = d(0)
  const inRange = (date: string) => date >= range.from && date <= range.to
  const byId = new Map(debts.map((x) => [x.id, x]))
  for (const x of debts) {
    if (!inRange(x.date)) continue
    const v = toBase(x.amount, x.currency, x.date)
    if (x.direction === 'owed_to_me') lent = lent.plus(v)
    else borrowed = borrowed.plus(v)
    // no money left (or came in): only what is owed changed
    if (!x.transaction_id) withoutMoney = x.direction === 'owed_to_me' ? withoutMoney.plus(v) : withoutMoney.minus(v)
  }
  for (const p of payments) {
    const x = byId.get(p.debt_id)
    if (!x || !inRange(p.date)) continue
    const v = toBase(p.amount, x.currency, p.date)
    if (x.direction === 'owed_to_me') receivedBack = receivedBack.plus(v)
    else paidBack = paidBack.plus(v)
    if (!p.transaction_id) withoutMoney = x.direction === 'owed_to_me' ? withoutMoney.minus(v) : withoutMoney.plus(v)
  }
  const any = [lent, receivedBack, borrowed, paidBack].some((v) => !v.isZero())
  return { lent, receivedBack, borrowed, paidBack, withoutMoney, any }
}
