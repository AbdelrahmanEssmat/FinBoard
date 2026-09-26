import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock } from 'lucide-react'
import { Button, Card, Divider, Input, Segmented } from '@/components/ui'
import { Amount, PageHeader } from '@/components/shared'
import { useHoldings, useInvestmentCategories } from '@/api/queries'
import { useUpdateRows } from '@/api/mutations'
import { useConvert } from '@/hooks/useMoney'
import { d, type Decimal } from '@/domain/money'
import { formatPercent } from '@/domain/format'
import { isPriceFresh } from '@/domain/investments'
import { toast } from '@/store/toasts'
import { byId, cn, relativeTime } from '@/utils'
import type { Holding } from '@/api/database.types'

type Mode = 'unit' | 'total'

/**
 * The daily price round: every open stock and fund on one screen. Type only what moved (per unit or
 * as the total value your broker shows), press Enter to jump to the next one, and save. Saving also
 * marks the prices you left alone as checked today.
 */
export default function UpdatePricesPage() {
  const navigate = useNavigate()
  const { data: all } = useHoldings()
  const { data: categories } = useInvestmentCategories()
  const catMap = useMemo(() => byId(categories), [categories])
  const { toDisplayOrZero, display } = useConvert()
  // sold-out holdings have no price to track
  const holdings = useMemo(() => (all ?? []).filter((h) => d(h.units).gt(0)), [all])
  // partial update: only the price columns change (an upsert would need every required column)
  const update = useUpdateRows('holdings', { silent: true })
  const [mode, setMode] = useState<Mode>('unit')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const inputs = useRef<(HTMLInputElement | null)[]>([])


  /** New per-unit price for a holding, or null when nothing valid was typed (a blank field means "same as before"). */
  const newPrice = (h: Holding): Decimal | null => {
    const raw = typed[h.id]?.trim().replace(/,/g, '')
    if (!raw || !/^\d*\.?\d+$|^\d+\.$/.test(raw)) return null
    const n = d(raw)
    return mode === 'unit' ? n : n.div(d(h.units))
  }
  const hasMoved = (h: Holding) => {
    const p = newPrice(h)
    return p !== null && p.toFixed(6) !== d(h.current_price).toFixed(6)
  }
  // switching between per-unit and total keeps what was typed, converted to the other form
  const switchMode = (m: Mode) => {
    if (m === mode) return
    const next: Record<string, string> = {}
    for (const h of holdings) {
      const p = newPrice(h)
      if (p === null) continue
      next[h.id] = m === 'unit' ? p.toDecimalPlaces(6).toString() : p.times(d(h.units)).toDecimalPlaces(2).toString()
    }
    setTyped(next)
    setMode(m)
  }
  const changed = holdings.filter(hasMoved)
  const freshCount = holdings.filter((h) => isPriceFresh(h.price_updated_at)).length

  const before = holdings.reduce((a, h) => a.plus(toDisplayOrZero(d(h.units).times(d(h.current_price)), h.currency)), d(0))
  const after = holdings.reduce((a, h) => a.plus(toDisplayOrZero(d(h.units).times(newPrice(h) ?? d(h.current_price)), h.currency)), d(0))
  const delta = after.minus(before)

  const save = async () => {
    if (!holdings.length) return
    const now = new Date().toISOString()
    const changedIds = new Set(changed.map((h) => h.id))
    await update.mutateAsync(
      holdings.map((h) => (changedIds.has(h.id) ? { id: h.id, current_price: newPrice(h)!.toFixed(6), price_updated_at: now } : { id: h.id, price_updated_at: now })),
    )
    const unchanged = holdings.length - changed.length
    toast.success(
      changed.length
        ? `Updated ${changed.length} price${changed.length === 1 ? '' : 's'}${unchanged ? ` · ${unchanged} unchanged` : ''}`
        : `All ${holdings.length} price${holdings.length === 1 ? '' : 's'} checked for today`,
    )
    navigate(-1)
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Update prices"
        subtitle={holdings.length ? `${freshCount} of ${holdings.length} checked today` : undefined}
        action={
          holdings.length ? (
            <Button size="sm" onClick={save} loading={update.isPending}>
              {changed.length ? `Save (${changed.length})` : 'Done'}
            </Button>
          ) : undefined
        }
      />

      {!holdings.length ? (
        <Card padded className="text-sm text-muted">
          No open stocks or funds. Add one from Investments.
        </Card>
      ) : (
        <div className="space-y-5">
          <Card padded>
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted">Stocks &amp; funds</div>
                <Amount value={after} currency={display} size="lg" className="mt-1 block" />
              </div>
              {changed.length ? (
                <div className={cn('shrink-0 text-right text-sm font-semibold', delta.gte(0) ? 'text-positive' : 'text-negative')}>
                  <Amount value={delta} currency={display} showSign />
                  {!before.isZero() ? <div className="text-xs font-medium">{formatPercent(delta.div(before).times(100))}</div> : null}
                </div>
              ) : (
                <span className="shrink-0 text-xs text-muted">Type only what moved</span>
              )}
            </div>
          </Card>

          <Segmented<Mode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'unit', label: 'Price per unit' },
              { value: 'total', label: 'Total value' },
            ]}
          />

          <Card className="overflow-hidden">
            {holdings.map((h, i) => {
              const p = newPrice(h)
              const was = d(h.current_price)
              const moved = hasMoved(h)
              const pct = moved && !was.isZero() ? p!.minus(was).div(was).times(100) : null
              const valueDelta = moved ? p!.minus(was).times(d(h.units)) : null
              const fresh = isPriceFresh(h.price_updated_at)
              const cat = h.category_id ? catMap.get(h.category_id)?.name : undefined
              return (
                <div key={h.id}>
                  {i > 0 ? <Divider /> : null}
                  {/* name and details take the free space; the field has a fixed width and never squeezes them */}
                  <label className="flex items-center gap-4 px-5 py-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">
                        {h.name}
                        {h.ticker ? <span className="ml-1.5 text-xs font-normal text-muted">{h.ticker}</span> : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {mode === 'unit' ? `${was.toFixed(2)} ${h.currency}` : `${d(h.units).toString()} units`}
                        {cat ? ` · ${cat}` : ''}
                      </span>
                      <span className={cn('mt-1 flex items-center gap-1 text-[11px]', fresh ? 'text-positive' : 'text-warning')}>
                        {fresh ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                        {fresh ? 'Checked today' : `Updated ${relativeTime(h.price_updated_at)}`}
                      </span>
                    </span>
                    <span className="flex w-32 shrink-0 flex-col items-end sm:w-40">
                      <Input
                        ref={(el) => {
                          inputs.current[i] = el
                        }}
                        inputMode="decimal"
                        enterKeyHint={i === holdings.length - 1 ? 'done' : 'next'}
                        aria-label={`${mode === 'unit' ? 'New price' : 'Total value'} for ${h.name}`}
                        className={cn('tnum h-11 text-right', moved && 'border-accent')}
                        placeholder={mode === 'unit' ? was.toFixed(2) : was.times(d(h.units)).toFixed(2)}
                        value={typed[h.id] ?? ''}
                        onChange={(e) => setTyped({ ...typed, [h.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          const next = inputs.current[i + 1]
                          if (next) next.focus()
                          else e.currentTarget.blur()
                        }}
                      />
                      <span className={cn('mt-1 h-4 whitespace-nowrap text-[11px] font-medium', pct?.gt(0) ? 'text-positive' : pct?.lt(0) ? 'text-negative' : 'text-faint')}>
                        {moved && valueDelta ? (
                          <>
                            {pct ? formatPercent(pct) + ' · ' : ''}
                            <Amount value={valueDelta} currency={h.currency} showSign decimals={0} />
                          </>
                        ) : (
                          'Same as before'
                        )}
                      </span>
                    </span>
                  </label>
                </div>
              )
            })}
          </Card>

          <Button full size="lg" onClick={save} loading={update.isPending}>
            {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Mark all as checked'}
          </Button>
        </div>
      )}
    </div>
  )
}
