import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HandCoins, Plus, Users } from 'lucide-react'
import { Amount, Button, Card, Divider, EmptyState, ListRow, PageHeader, Pill, ProgressBar, Segmented } from '@/components/ui'
import { formatDate } from '@/domain/format'
import { DebtForm } from './DebtForm'
import { ContactForm } from './ContactForm'
import { useDebtViews, type DebtView } from './hooks'
import type { Contact } from '@/lib/database.types'

type Tab = 'i_owe' | 'owed_to_me' | 'people'

export default function DebtsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'owed_to_me'
  const { open, totals, byPerson, display, list } = useDebtViews()
  const [form, setForm] = useState<{ open: boolean; direction: 'i_owe' | 'owed_to_me' }>({ open: false, direction: 'owed_to_me' })
  const [contactForm, setContactForm] = useState<{ open: boolean; item?: Contact | null }>({ open: false })

  const items = open.filter((x) => x.direction === tab).sort((a, b) => Number(b.overdue) - Number(a.overdue))
  const settled = list.filter((x) => x.status === 'settled' && x.direction === tab)

  return (
    <div className="anim-fade-up">
      <PageHeader
        title="Debts"
        subtitle={
          <span>
            Net <Amount value={totals.net} currency={display} colored className="font-medium" />
          </span>
        }
        action={
          tab === 'people' ? (
            <Button size="sm" variant="soft" onClick={() => setContactForm({ open: true, item: null })}>
              <Plus className="h-4 w-4" /> Person
            </Button>
          ) : (
            <Button size="sm" variant="soft" onClick={() => setForm({ open: true, direction: tab })}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted">Owed to me</div>
          <Amount value={totals.owedToMe} currency={display} size="lg" className="text-positive" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">I owe</div>
          <Amount value={totals.iOwe} currency={display} size="lg" className="text-negative" />
        </Card>
      </div>

      <Segmented className="mb-4" value={tab} onChange={(t) => setParams({ tab: t })} options={[{ value: 'owed_to_me', label: 'Owed to me' }, { value: 'i_owe', label: 'I owe' }, { value: 'people', label: 'People' }]} />

      {tab === 'people' ? (
        !byPerson.length ? (
          <EmptyState icon={Users} title="No people yet" description="People are saved when you add a debt, or add them here." action={<Button onClick={() => setContactForm({ open: true, item: null })}>Add person</Button>} />
        ) : (
          <Card className="overflow-hidden">
            {byPerson.map((p, i) => (
              <div key={p.contact.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  icon={Users}
                  color={p.net.gt(0) ? '#16a34a' : p.net.lt(0) ? '#dc2626' : '#64748b'}
                  title={p.contact.name}
                  subtitle={p.openCount ? `${p.openCount} open · ${Object.entries(p.byCurrency).map(([c, v]) => `${v.gt(0) ? 'owes you' : 'you owe'} ${v.abs().toFixed(0)} ${c}`).join(', ')}` : 'All settled'}
                  trailing={<Amount value={p.net} currency={display} colored showSign className="font-semibold" />}
                  onClick={() => setContactForm({ open: true, item: p.contact })}
                  chevron
                />
              </div>
            ))}
          </Card>
        )
      ) : !items.length && !settled.length ? (
        <EmptyState
          icon={HandCoins}
          title={tab === 'i_owe' ? 'You owe nobody' : 'Nobody owes you'}
          description={tab === 'i_owe' ? 'Record money you borrowed and track repayments here.' : 'Record money you lent and track what comes back.'}
          action={<Button onClick={() => setForm({ open: true, direction: tab })}>{tab === 'i_owe' ? 'Add what I owe' : 'Add what I’m owed'}</Button>}
        />
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            {items.map((x, i) => (
              <div key={x.id}>
                {i > 0 ? <Divider /> : null}
                <DebtRow debt={x} onClick={() => navigate(`/debts/${x.id}`)} />
              </div>
            ))}
            {!items.length ? <p className="p-4 text-sm text-muted">Nothing open.</p> : null}
          </Card>
          {settled.length ? (
            <div>
              <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Settled</h2>
              <Card className="overflow-hidden opacity-70">
                {settled.map((x, i) => (
                  <div key={x.id}>
                    {i > 0 ? <Divider /> : null}
                    <DebtRow debt={x} onClick={() => navigate(`/debts/${x.id}`)} />
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
        </div>
      )}

      <DebtForm open={form.open} onClose={() => setForm({ ...form, open: false })} direction={form.direction} />
      <ContactForm open={contactForm.open} onClose={() => setContactForm({ open: false })} initial={contactForm.item ?? null} />
    </div>
  )
}

function DebtRow({ debt, onClick }: { debt: DebtView; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-surface-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{debt.contact?.name ?? 'Unknown'}</span>
            {debt.overdue ? <Pill tone="negative">overdue</Pill> : debt.next ? <Pill>{`due ${formatDate(debt.next.dueDate)}`}</Pill> : null}
          </div>
          <div className="truncate text-xs text-muted">{debt.reason || formatDate(debt.date)}</div>
        </div>
        <div className="text-right">
          <Amount value={debt.remaining} currency={debt.currency} className="font-semibold" />
          <div className="text-[11px] text-muted">
            of <Amount value={debt.amount} currency={debt.currency} size="sm" />
          </div>
        </div>
      </div>
      <ProgressBar value={debt.percent} color={debt.direction === 'owed_to_me' ? 'var(--color-positive)' : 'var(--color-negative)'} />
    </button>
  )
}
