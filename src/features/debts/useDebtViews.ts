import { useMemo } from 'react'
import { useContacts, useDebtPayments, useDebts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { debtProgress, installmentPlan, type InstallmentDue } from '@/domain/installments'
import { d, Decimal } from '@/domain/money'
import { todayIso } from '@/domain/format'
import { byId } from '@/utils'
import type { Contact, Debt, DebtPayment } from '@/api/database.types'

export interface DebtView extends Debt {
  contact: Contact | undefined
  payments: DebtPayment[]
  paid: Decimal
  remaining: Decimal
  percent: number
  plan: InstallmentDue[]
  next: InstallmentDue | null
  overdue: boolean
  /** remaining in the display currency */
  remainingDisplay: Decimal
}

export function useDebtViews() {
  const debts = useDebts()
  const payments = useDebtPayments()
  const contacts = useContacts()
  const { toDisplayOrZero, display } = useConvert()
  const today = todayIso()

  const list = useMemo<DebtView[]>(() => {
    const contactMap = byId(contacts.data)
    const byDebt = new Map<string, DebtPayment[]>()
    for (const p of payments.data ?? []) {
      ;(byDebt.get(p.debt_id) ?? byDebt.set(p.debt_id, []).get(p.debt_id)!).push(p)
    }
    return (debts.data ?? []).map((debt) => {
      const pays = byDebt.get(debt.id) ?? []
      const prog = debtProgress(debt, pays)
      const plan = installmentPlan(debt, pays, today)
      const next = plan.find((p) => p.status !== 'paid') ?? null
      return {
        ...debt,
        contact: contactMap.get(debt.contact_id),
        payments: pays,
        paid: prog.paid,
        remaining: prog.remaining,
        percent: prog.percent,
        plan,
        next,
        overdue: debt.status === 'open' && plan.some((p) => p.status === 'overdue'),
        remainingDisplay: toDisplayOrZero(prog.remaining, debt.currency),
      }
    })
  }, [debts.data, payments.data, contacts.data, toDisplayOrZero, today])

  const open = list.filter((x) => x.status === 'open')
  const totals = useMemo(() => {
    let iOwe = d(0)
    let owedToMe = d(0)
    for (const x of open) {
      if (x.direction === 'i_owe') iOwe = iOwe.plus(x.remainingDisplay)
      else owedToMe = owedToMe.plus(x.remainingDisplay)
    }
    return { iOwe, owedToMe, net: owedToMe.minus(iOwe) }
  }, [open])

  /** Net position per person (positive = they owe me) in the display currency. */
  const byPerson = useMemo(() => {
    const map = new Map<string, { contact: Contact; net: Decimal; openCount: number; byCurrency: Record<string, Decimal> }>()
    for (const x of list) {
      if (!x.contact) continue
      const entry = map.get(x.contact_id) ?? { contact: x.contact, net: d(0), openCount: 0, byCurrency: {} }
      if (x.status === 'open') {
        const sign = x.direction === 'owed_to_me' ? 1 : -1
        entry.net = entry.net.plus(x.remainingDisplay.times(sign))
        entry.byCurrency[x.currency] = (entry.byCurrency[x.currency] ?? d(0)).plus(x.remaining.times(sign))
        entry.openCount++
      }
      map.set(x.contact_id, entry)
    }
    for (const c of contacts.data ?? []) if (!map.has(c.id)) map.set(c.id, { contact: c, net: d(0), openCount: 0, byCurrency: {} })
    return Array.from(map.values()).sort((a, b) => a.contact.name.localeCompare(b.contact.name))
  }, [list, contacts.data])

  return { list, open, totals, byPerson, display, isLoading: debts.isLoading || payments.isLoading }
}
