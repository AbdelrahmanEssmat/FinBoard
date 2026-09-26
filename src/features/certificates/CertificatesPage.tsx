import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Percent, Plus } from 'lucide-react'
import { Amount, Button, Card, Divider, EmptyState, ListRow, PageHeader, Pill, SectionTitle } from '@/components/ui'
import { useAccounts, useCertificates, usePayouts } from '@/lib/data/tables'
import { useConvert } from '@/lib/data/derived'
import { byId } from '@/lib/utils'
import { d } from '@/domain/money'
import { daysUntil, nextPayoutDate, PAYOUT_LABELS, payoutAmount } from '@/domain/certificates'
import { formatDate, todayIso } from '@/domain/format'
import { CertificateForm } from './CertificateForm'

export default function CertificatesPage() {
  const navigate = useNavigate()
  const { data: certs } = useCertificates()
  const { data: payouts } = usePayouts()
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const { toDisplayOrZero, display } = useConvert()
  const [adding, setAdding] = useState(false)
  const today = todayIso()

  const active = (certs ?? []).filter((c) => !c.is_closed)
  const closed = (certs ?? []).filter((c) => c.is_closed)
  const total = active.reduce((a, c) => a.plus(toDisplayOrZero(c.principal, c.currency)), d(0))
  const monthlyIncome = active.reduce((a, c) => {
    const per = payoutAmount(c)
    const perMonth = c.payout_frequency === 'monthly' ? per : c.payout_frequency === 'quarterly' ? per.div(3) : c.payout_frequency === 'semi_annual' ? per.div(6) : c.payout_frequency === 'annual' ? per.div(12) : d(0)
    return a.plus(toDisplayOrZero(perMonth, c.currency))
  }, d(0))
  const pendingDue = (payouts ?? []).filter((p) => p.status === 'pending' && p.due_date <= today).length

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Certificates"
        action={
          <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      {!certs?.length ? (
        <EmptyState icon={Percent} title="No certificates yet" description="Track bank certificates and deposits: payouts, interest earned and maturity dates." action={<Button onClick={() => setAdding(true)}>Add certificate</Button>} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted">Invested</div>
              <Amount value={total} currency={display} size="lg" />
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Interest / month</div>
              <Amount value={monthlyIncome} currency={display} size="lg" className="text-positive" />
            </Card>
          </div>
          {pendingDue ? <div className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{pendingDue} payout{pendingDue > 1 ? 's' : ''} waiting to be logged.</div> : null}
          <div>
            <SectionTitle>Active</SectionTitle>
            <Card className="overflow-hidden">
              {active.map((c, i) => {
                const next = nextPayoutDate(c, today)
                const matureIn = daysUntil(c.maturity_date, today)
                return (
                  <div key={c.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow
                      icon={Percent}
                      color={accMap.get(c.account_id)?.color ?? '#eab308'}
                      title={c.name}
                      subtitle={`${accMap.get(c.account_id)?.name ?? ''} · ${c.interest_rate}% ${PAYOUT_LABELS[c.payout_frequency].toLowerCase()}`}
                      trailing={
                        <span className="flex flex-col items-end gap-1">
                          <Amount value={c.principal} currency={c.currency} className="font-semibold" />
                          {matureIn <= 30 ? <Pill tone="warning">matures in {matureIn} d</Pill> : next ? <span className="text-[11px] text-muted">next {formatDate(next)}</span> : null}
                        </span>
                      }
                      chevron
                      onClick={() => navigate(`/certificates/${c.id}`)}
                    />
                  </div>
                )
              })}
              {!active.length ? <p className="p-4 text-sm text-muted">None active.</p> : null}
            </Card>
          </div>
          {closed.length ? (
            <div>
              <SectionTitle>Closed</SectionTitle>
              <Card className="overflow-hidden opacity-70">
                {closed.map((c, i) => (
                  <div key={c.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow icon={Percent} title={c.name} subtitle={`Matured ${formatDate(c.maturity_date)}`} trailing={<Amount value={c.principal} currency={c.currency} />} chevron onClick={() => navigate(`/certificates/${c.id}`)} />
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
        </div>
      )}
      <CertificateForm open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
