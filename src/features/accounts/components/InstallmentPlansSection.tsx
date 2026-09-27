import { useState } from 'react'
import { CalendarCheck, Plus } from 'lucide-react'
import { Button, Card, ConfirmDialog, Divider, Sheet } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import { useUndoableDelete, useUpdateRows } from '@/api/mutations'
import { formatDate, todayIso } from '@/domain/format'
import { installmentSchedule } from '@/domain/creditCard'
import { cn } from '@/utils'
import { InstallmentPurchaseSheet } from '@/features/accounts/components/InstallmentPurchaseSheet'
import type { CreditCardView } from '@/hooks/useCreditCards'
import type { CardInstallmentPlan } from '@/api/database.types'

/** A card's installment plans: what each costs a month, how far along it is, and its schedule. */
export function InstallmentPlansSection({ card }: { card: CreditCardView }) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const active = card.plans.filter((p) => p.progress?.status === 'active')
  const finished = card.plans.filter((p) => p.progress && p.progress.status !== 'active')
  const selected = card.plans.find((p) => p.plan.id === openId)

  return (
    <>
      <Section
        title="Installment plans"
        action={
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs font-medium text-accent">
            <Plus className="h-3.5 w-3.5" /> Installment purchase
          </button>
        }
      >
        {!card.plans.length ? (
          <Card padded className="text-sm leading-relaxed text-muted">
            Bought something in installments with this card? Add it here: the full price counts against your limit, and each statement bills one installment.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {[...active, ...finished].map(({ plan, progress }, i) => (
              <div key={plan.id}>
                {i > 0 ? <Divider /> : null}
                <button onClick={() => setOpenId(plan.id)} className="w-full px-5 py-4 text-left transition-colors hover:bg-surface-2 active:bg-surface-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[15px] font-medium">{plan.description}</span>
                    {progress ? <Amount value={progress.monthly} currency={plan.currency} className="shrink-0 text-sm font-semibold" /> : null}
                  </div>
                  {progress ? (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className={cn('h-full rounded-full', progress.status === 'active' ? 'bg-accent' : 'bg-positive')} style={{ width: `${(progress.billedCount / plan.months) * 100}%` }} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted">
                        <span className="truncate">
                          {progress.status === 'settled' ? 'Settled early' : progress.status === 'done' ? `All ${plan.months} billed` : `${progress.billedCount} of ${plan.months} billed`}
                          {progress.status === 'active' && progress.next ? ` · next ${formatDate(progress.next.date, 'd MMM')}` : ''}
                        </span>
                        {progress.status === 'active' ? (
                          <span className="shrink-0">
                            <Amount value={progress.unbilled} currency={plan.currency} decimals={0} /> left
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </button>
              </div>
            ))}
          </Card>
        )}
      </Section>
      <InstallmentPurchaseSheet open={adding} onClose={() => setAdding(false)} preset={{ cardAccountId: card.account.id }} />
      <PlanSheet card={card} plan={selected?.plan ?? null} onClose={() => setOpenId(null)} />
    </>
  )
}

function PlanSheet({ card, plan, onClose }: { card: CreditCardView; plan: CardInstallmentPlan | null; onClose: () => void }) {
  const update = useUpdateRows('card_installment_plans', { silent: true })
  const remove = useUndoableDelete('card_installment_plans', { label: 'Plan' })
  const [confirm, setConfirm] = useState<'settle' | 'delete' | null>(null)
  if (!plan) return null
  const today = todayIso()
  const sd = card.account.statement_day ?? 1
  const progress = card.plans.find((p) => p.plan.id === plan.id)?.progress
  const schedule = installmentSchedule(plan, sd)
  const settled = Boolean(plan.closed_at)

  return (
    <Sheet open={!!plan} onClose={onClose} title={plan.description}>
      <div className="space-y-5 pb-2">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Price" value={<Amount value={plan.principal} currency={plan.currency} />} />
          <Stat label="Interest & fees" value={<Amount value={plan.fees} currency={plan.currency} />} />
          <Stat label="Each month" value={progress ? <Amount value={progress.monthly} currency={plan.currency} /> : '—'} />
          <Stat label="Still to be billed" value={progress ? <Amount value={progress.unbilled} currency={plan.currency} /> : '—'} />
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <CalendarCheck className="h-3.5 w-3.5" /> Schedule
          </div>
          <div className="divide-y divide-border rounded-2xl border border-border">
            {schedule.map((it) => {
              const billed = it.date <= today || (settled && plan.closed_at! <= today)
              const isNext = progress?.next?.n === it.n && !settled
              return (
                <div key={it.n} className={cn('flex items-center justify-between gap-3 px-4 py-2.5 text-sm', isNext && 'bg-accent-soft')}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={cn('w-6 shrink-0 text-xs font-semibold', billed ? 'text-positive' : 'text-faint')}>{it.n}</span>
                    <span className={cn('truncate', billed ? 'text-muted' : '')}>{formatDate(it.date, 'd MMM yyyy')}</span>
                    {isNext ? <span className="text-[11px] font-semibold text-accent">next</span> : null}
                  </span>
                  <Amount value={it.amount} currency={plan.currency} className={cn('shrink-0', billed ? 'text-muted' : 'font-medium')} />
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-muted">Bought {formatDate(plan.purchase_date, 'd MMM yyyy')}. Each amount is billed on that statement, then due by the card&apos;s due date.</p>
        </div>

        {settled ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Settled early on {formatDate(plan.closed_at, 'd MMM yyyy')}: what was left went onto the next statement.</p>
        ) : null}

        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {!settled && progress?.status === 'active' ? (
            <Button variant="soft" onClick={() => setConfirm('settle')}>
              Settle early
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setConfirm('delete')} className="text-negative">
            Delete plan
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'settle'}
        onClose={() => setConfirm(null)}
        title="Settle this plan early?"
        message="Whatever hasn't been billed yet goes onto your next statement, due by its due date. Check your bank's early-settlement fee and add it as an expense on the card if there is one."
        confirmLabel="Settle"
        danger={false}
        onConfirm={async () => {
          await update.mutateAsync([{ id: plan.id, closed_at: today }])
          onClose()
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this plan?"
        message="The purchase stays on the card, but as a normal purchase: the full amount counts on the statement. To remove the purchase too, delete it from the card's activity."
        onConfirm={() => {
          remove(plan)
          onClose()
        }}
      />
    </Sheet>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  )
}
