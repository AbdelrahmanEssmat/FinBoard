import { addDays, addMonths, addWeeks, addYears, format, parseISO } from 'date-fns'
import { d, Decimal, sum, type NumericInput } from '@/domain/money'

export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface DebtLike {
  amount: NumericInput
  plan_count?: number | null
  plan_amount?: NumericInput
  plan_frequency?: Recurrence | null
  plan_start_date?: string | null
  due_date?: string | null
}

export interface PaymentLike {
  amount: NumericInput
  date: string
}

export interface DebtProgress {
  total: Decimal
  paid: Decimal
  remaining: Decimal
  percent: number // 0..100
  isSettled: boolean
}

export function debtProgress(debt: DebtLike, payments: PaymentLike[]): DebtProgress {
  const total = d(debt.amount)
  const paid = sum(payments.map((p) => p.amount))
  const remaining = Decimal.max(total.minus(paid), 0)
  const percent = total.isZero() ? 100 : Math.min(100, paid.div(total).times(100).toNumber())
  return { total, paid, remaining, percent, isSettled: remaining.isZero() }
}

export function addPeriod(date: Date, freq: Recurrence, count = 1): Date {
  switch (freq) {
    case 'daily':
      return addDays(date, count)
    case 'weekly':
      return addWeeks(date, count)
    case 'monthly':
      return addMonths(date, count)
    case 'yearly':
      return addYears(date, count)
  }
}

export interface InstallmentDue {
  index: number
  dueDate: string
  amount: Decimal
  /** How much of this installment has been covered by payments so far (payments are applied oldest first). */
  paid: Decimal
  status: 'paid' | 'due' | 'overdue' | 'upcoming'
}

/**
 * Build the installment plan and mark each one paid/overdue/upcoming by allocating
 * payments oldest-first. Debts without a plan get a single installment on due_date (if any).
 */
export function installmentPlan(debt: DebtLike, payments: PaymentLike[], today: string): InstallmentDue[] {
  const total = d(debt.amount)
  const items: { dueDate: string; amount: Decimal }[] = []

  if (debt.plan_count && debt.plan_frequency && debt.plan_start_date) {
    const count = debt.plan_count
    const per = debt.plan_amount ? d(debt.plan_amount) : total.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN)
    let running = new Decimal(0)
    for (let i = 0; i < count; i++) {
      const due = format(addPeriod(parseISO(debt.plan_start_date), debt.plan_frequency, i), 'yyyy-MM-dd')
      const isLast = i === count - 1
      const amount = isLast ? Decimal.max(total.minus(running), 0) : per
      items.push({ dueDate: due, amount })
      running = running.plus(amount)
    }
  } else if (debt.due_date) {
    items.push({ dueDate: debt.due_date, amount: total })
  } else {
    return []
  }

  let pool = sum(payments.map((p) => p.amount))
  return items.map((it, index) => {
    const covered = Decimal.min(pool, it.amount)
    pool = pool.minus(covered)
    const fullyPaid = covered.gte(it.amount)
    let status: InstallmentDue['status']
    if (fullyPaid) status = 'paid'
    else if (it.dueDate < today) status = 'overdue'
    else if (it.dueDate === today) status = 'due'
    else status = 'upcoming'
    return { index, dueDate: it.dueDate, amount: it.amount, paid: covered, status }
  })
}

export function nextInstallment(plan: InstallmentDue[]): InstallmentDue | null {
  return plan.find((p) => p.status !== 'paid') ?? null
}
