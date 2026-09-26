import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CloudSun, Plus } from 'lucide-react'
import { Button, Card, Divider, Pill } from '@/components/ui'
import { Amount, Section } from '@/components/shared'
import { formatDate } from '@/domain/format'
import { YIELD_LABELS } from '@/domain/yield'
import { CloudForm } from '@/features/investments/components/CloudForm'
import { TransactionForm } from '@/features/transactions/components/TransactionForm'
import { useClouds, type CloudView } from '@/features/investments/useClouds'

export function CloudsSection() {
  const { list, projectedMonthlyDisplay, display } = useClouds()
  const [form, setForm] = useState<{ open: boolean; item?: CloudView | null }>({ open: false })
  const [move, setMove] = useState<{ open: boolean; cloud?: CloudView; direction: 'in' | 'out' }>({ open: false, direction: 'in' })

  return (
    <Section
      title="Clouds"
      action={
        <button onClick={() => setForm({ open: true, item: null })} className="flex items-center gap-1 text-xs font-medium text-accent">
          <Plus className="h-3.5 w-3.5" /> Cloud
        </button>
      }
    >
      {!list.length ? (
        <Card padded className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CloudSun className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Savings that earn while they wait</div>
            <p className="mt-1 text-sm leading-relaxed text-muted">Add a Thndr Cloud: money you park in it earns a yearly rate paid daily or monthly. Interest is posted automatically and counts in your net worth.</p>
            <Button size="sm" variant="soft" className="mt-3" onClick={() => setForm({ open: true, item: null })}>
              Add Cloud
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {list.map((c, i) => (
            <div key={c.id}>
              {i > 0 ? <Divider /> : null}
              <div className="px-5 py-4">
                <button onClick={() => setForm({ open: true, item: c })} className="flex w-full items-center gap-4 text-left">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <CloudSun className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium">{c.name ?? 'Cloud'}</span>
                      <Pill tone="accent">{c.yield_rate}%</Pill>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {c.account?.name} · {YIELD_LABELS[c.frequency].toLowerCase()} · next {c.frequency === 'daily' ? 'tomorrow' : formatDate(c.nextPayout)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <Amount value={c.balance} currency={c.currency} className="font-semibold" />
                    <span className="text-[11px] text-positive">
                      +<Amount value={c.earnedThisMonth} currency={c.currency} size="sm" className="text-[11px]" /> this month
                    </span>
                  </span>
                </button>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" variant="soft" onClick={() => setMove({ open: true, cloud: c, direction: 'in' })}>
                    <ArrowDownToLine className="h-3.5 w-3.5" /> Deposit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setMove({ open: true, cloud: c, direction: 'out' })}>
                    <ArrowUpFromLine className="h-3.5 w-3.5" /> Withdraw
                  </Button>
                  <span className="ml-auto text-[11px] text-muted">
                    ~<Amount value={c.projectedMonthly} currency={c.currency} size="sm" className="text-[11px]" />/mo · earned <Amount value={c.earnedTotal} currency={c.currency} size="sm" className="text-[11px]" />
                  </span>
                </div>
              </div>
            </div>
          ))}
          <Divider />
          <div className="flex items-center justify-between px-5 py-3 text-xs text-muted">
            <span>Expected interest per month</span>
            <Amount value={projectedMonthlyDisplay} currency={display} className="text-sm font-semibold text-positive" />
          </div>
        </Card>
      )}
      <CloudForm open={form.open} onClose={() => setForm({ open: false })} initial={form.item ?? null} />
      <TransactionForm
        key={`${move.cloud?.id ?? ''}-${move.direction}`}
        open={move.open}
        onClose={() => setMove({ ...move, open: false })}
        defaultType="transfer"
        presetToSubAccountId={move.direction === 'in' ? move.cloud?.id : undefined}
        presetSubAccountId={move.direction === 'out' ? move.cloud?.id : undefined}
      />
    </Section>
  )
}
