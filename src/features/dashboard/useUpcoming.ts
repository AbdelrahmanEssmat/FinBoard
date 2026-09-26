import { useMemo } from 'react'
import { Calendar, HandCoins, Percent, Repeat, type LucideIcon } from 'lucide-react'
import { useCertificates, usePayouts, useRecurring } from '@/api/queries'
import { useDebtViews } from '@/features/debts/useDebtViews'
import { d, type Decimal } from '@/domain/money'
import { daysUntil } from '@/domain/certificates'
import { upcomingOccurrences } from '@/domain/recurring'
import { todayIso } from '@/domain/format'
import { addDaysIso } from '@/utils'

export interface UpcomingItem {
  key: string
  date: string
  title: string
  subtitle: string
  amount: Decimal | null
  currency: string
  icon: LucideIcon
  color: string
  overdue?: boolean
  to: string
}

/** Certificate payouts and maturities, debt installments and recurring bills in the next `days` days. */
export function useUpcoming(days = 30, limit = 8): UpcomingItem[] {
  const { data: payouts } = usePayouts()
  const { data: certs } = useCertificates()
  const { data: recurring } = useRecurring()
  const { open: openDebts } = useDebtViews()
  const today = todayIso()

  return useMemo(() => {
    const until = addDaysIso(today, days)
    const items: UpcomingItem[] = []
    const certMap = new Map((certs ?? []).map((c) => [c.id, c]))

    for (const p of payouts ?? []) {
      if (p.status !== 'pending' || p.due_date > until) continue
      const c = certMap.get(p.certificate_id)
      if (!c || c.is_closed) continue
      items.push({ key: 'p' + p.id, date: p.due_date, title: `${c.name} payout`, subtitle: p.due_date < today ? 'Not logged yet' : 'Certificate interest', amount: d(p.amount), currency: c.currency, icon: Percent, color: '#eab308', overdue: p.due_date < today, to: `/certificates/${c.id}` })
    }
    for (const c of certs ?? []) {
      if (!c.is_closed && c.maturity_date >= today && c.maturity_date <= until) {
        items.push({ key: 'm' + c.id, date: c.maturity_date, title: `${c.name} matures`, subtitle: `in ${daysUntil(c.maturity_date, today)} days`, amount: d(c.principal), currency: c.currency, icon: Calendar, color: '#0ea5e9', to: `/certificates/${c.id}` })
      }
    }
    for (const x of openDebts) {
      const nxt = x.next
      if (!nxt || nxt.dueDate > until) continue
      items.push({ key: 'd' + x.id, date: nxt.dueDate, title: x.direction === 'i_owe' ? `Pay ${x.contact?.name ?? ''}` : `${x.contact?.name ?? ''} pays you`, subtitle: 'Installment', amount: nxt.amount.minus(nxt.paid), currency: x.currency, icon: HandCoins, color: x.direction === 'i_owe' ? '#dc2626' : '#16a34a', overdue: nxt.status === 'overdue', to: `/debts/${x.id}` })
    }
    for (const r of recurring ?? []) {
      for (const dt of upcomingOccurrences(r, today, days).slice(0, 2)) {
        items.push({ key: 'r' + r.id + dt, date: dt, title: r.name, subtitle: r.auto_post ? 'Recurring · auto' : 'Recurring · reminder', amount: d(r.amount), currency: r.currency, icon: Repeat, color: r.type === 'income' ? '#16a34a' : '#f97316', to: '/recurring' })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit)
  }, [payouts, certs, openDebts, recurring, today, days, limit])
}
