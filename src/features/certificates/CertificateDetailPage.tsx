import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { Amount, Button, Card, ConfirmDialog, Divider, ListRow, PageHeader, Pill, SectionTitle, Select, Sheet } from '@/components/ui'
import { useAccounts, useCertificates, usePayouts, useSubAccounts } from '@/lib/data/tables'
import { useRpc, useUndoableDelete, useUpsert } from '@/lib/data/mutations'
import { byId } from '@/lib/utils'
import { daysUntil, interestEarnedSoFar, nextPayoutDate, PAYOUT_LABELS, payoutAmount, totalExpectedInterest } from '@/domain/certificates'
import { formatDate, todayIso } from '@/domain/format'
import { CertificateForm } from './CertificateForm'
import type { CertificatePayout } from '@/lib/database.types'

export default function CertificateDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: certs } = useCertificates()
  const { data: payouts } = usePayouts()
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  const cert = certs?.find((c) => c.id === id)
  const mine = useMemo(() => (payouts ?? []).filter((p) => p.certificate_id === id).sort((a, b) => a.due_date.localeCompare(b.due_date)), [payouts, id])
  const [edit, setEdit] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [logging, setLogging] = useState<CertificatePayout | null>(null)
  const [logSub, setLogSub] = useState('')
  const remove = useUndoableDelete('certificates', { invalidate: ['certificate_payouts'], label: 'Certificate' })
  const logPayout = useRpc('log_certificate_payout', ['certificate_payouts', 'transactions', 'sub_accounts'])
  const updatePayout = useUpsert('certificate_payouts', { silent: true })
  const today = todayIso()

  if (!cert) return <div className="py-12 text-center text-muted">Not found</div>
  const earned = interestEarnedSoFar(cert, today)
  const next = nextPayoutDate(cert, today)
  const matureIn = daysUntil(cert.maturity_date, today)
  const per = payoutAmount(cert)
  const expected = totalExpectedInterest(cert)
  const pendingDue = mine.filter((p) => p.status === 'pending' && p.due_date <= today)
  const payoutSubs = (subs ?? []).filter((s) => !s.is_archived && s.currency === cert.currency)

  const doLog = async () => {
    if (!logging) return
    await logPayout.mutateAsync({ p_payout_id: logging.id, p_sub_account_id: logSub || cert.payout_sub_account_id || null })
    setLogging(null)
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title={cert.name}
        subtitle={accMap.get(cert.account_id)?.name}
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEdit(true)}>
              <Pencil className="h-5 w-5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setConfirm(true)}>
              <Trash2 className="h-5 w-5 text-negative" />
            </Button>
          </div>
        }
      />

      <Card className="mb-4 p-5">
        <div className="text-xs text-muted">Principal</div>
        <Amount value={cert.principal} currency={cert.currency} size="xl" />
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Stat label="Rate" value={`${cert.interest_rate}% / year`} />
          <Stat label="Payout" value={PAYOUT_LABELS[cert.payout_frequency]} />
          <Stat label="Each payout" value={<Amount value={per} currency={cert.currency} />} />
          <Stat label="Total expected" value={<Amount value={expected} currency={cert.currency} />} />
          <Stat label="Earned so far" value={<Amount value={earned.total} currency={cert.currency} className="text-positive" />} hint={earned.accrued.gt(0) ? `incl. ${earned.accrued.toFixed(2)} accrued` : undefined} />
          <Stat label="Next payout" value={next ? formatDate(next) : '—'} hint={next ? `in ${daysUntil(next, today)} days` : undefined} />
          <Stat label="Started" value={formatDate(cert.start_date)} />
          <Stat label="Matures" value={formatDate(cert.maturity_date)} hint={matureIn >= 0 ? `in ${matureIn} days` : 'matured'} />
        </div>
        {cert.notes ? <p className="mt-3 text-sm text-muted">{cert.notes}</p> : null}
        {cert.is_closed ? <Pill className="mt-3">Closed</Pill> : null}
      </Card>

      {pendingDue.length ? (
        <Card className="mb-4 flex items-center justify-between gap-3 bg-warning-soft p-4">
          <span className="text-sm text-warning">
            {pendingDue.length} payout{pendingDue.length > 1 ? 's' : ''} due to be logged as income
          </span>
          <Button size="sm" onClick={() => { setLogging(pendingDue[0]!); setLogSub(cert.payout_sub_account_id ?? payoutSubs[0]?.id ?? '') }}>
            Log
          </Button>
        </Card>
      ) : null}

      <SectionTitle>Payout schedule</SectionTitle>
      <Card className="overflow-hidden">
        {mine.map((p, i) => (
          <div key={p.id}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={formatDate(p.due_date)}
              subtitle={p.status === 'logged' ? 'Logged as income' : p.status === 'skipped' ? 'Skipped' : p.due_date <= today ? 'Due — not logged yet' : 'Upcoming'}
              trailing={
                <span className="flex items-center gap-2">
                  <Amount value={p.amount} currency={cert.currency} className="font-medium" />
                  {p.status === 'logged' ? <CheckCircle2 className="h-4 w-4 text-positive" /> : p.status === 'pending' && p.due_date <= today ? <Pill tone="warning">due</Pill> : p.status === 'skipped' ? <Pill>skipped</Pill> : null}
                </span>
              }
              onClick={p.status === 'pending' ? () => { setLogging(p); setLogSub(cert.payout_sub_account_id ?? payoutSubs[0]?.id ?? '') } : undefined}
            />
          </div>
        ))}
        {!mine.length ? <p className="p-4 text-sm text-muted">No payouts scheduled.</p> : null}
      </Card>

      <Sheet open={Boolean(logging)} onClose={() => setLogging(null)} title="Log payout as income">
        {logging ? (
          <div className="space-y-4 pb-2">
            <p className="text-sm text-muted">
              <Amount value={logging.amount} currency={cert.currency} className="font-semibold text-text" /> due {formatDate(logging.due_date)}
            </p>
            <Select value={logSub} onChange={(e) => setLogSub(e.target.value)}>
              <option value="">Choose account…</option>
              {payoutSubs.map((s) => (
                <option key={s.id} value={s.id}>
                  {accMap.get(s.account_id)?.name} · {s.currency}
                  {s.name ? ' · ' + s.name : ''}
                </option>
              ))}
            </Select>
            <Button full size="lg" onClick={doLog} loading={logPayout.isPending} disabled={!logSub}>
              Add income
            </Button>
            <Button full variant="ghost" onClick={async () => { await updatePayout.mutateAsync([{ id: logging.id, status: 'skipped' }]); setLogging(null) }}>
              Skip this payout
            </Button>
          </div>
        ) : null}
      </Sheet>
      <CertificateForm open={edit} onClose={() => setEdit(false)} initial={cert} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this certificate?"
        message="Logged interest transactions are kept."
        onConfirm={() => {
          remove(cert)
          navigate('/certificates')
        }}
      />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium">{value}</div>
      {hint ? <div className="text-[11px] text-faint">{hint}</div> : null}
    </div>
  )
}
