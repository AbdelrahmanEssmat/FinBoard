import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Clock, ImagePlus, ScanLine } from 'lucide-react'
import { Button, Card, Divider, Input, Segmented } from '@/components/ui'
import { ScanPricesSheet } from '@/features/investments/components/ScanPricesSheet'
import { useScreenshotIntake } from '@/features/investments/components/useScreenshotIntake'
import { releaseOcrWorker } from '@/ocr/worker'
import { Amount, PageHeader } from '@/components/shared'
import { useHoldings, useInvestmentCategories } from '@/api/queries'
import { useUpdateRows } from '@/api/mutations'
import { useConvert } from '@/hooks/useMoney'
import { d, parseAmount, type Decimal } from '@/domain/money'
import { formatPercent } from '@/domain/format'
import { isPriceFresh } from '@/domain/investments'
import { toast } from '@/store/toasts'
import { usePrefs } from '@/store/prefs'
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
  const privacy = usePrefs((s) => s.privacy)
  // sold-out holdings have no price to track
  const holdings = useMemo(() => (all ?? []).filter((h) => d(h.units).gt(0)), [all])
  // partial update: only the price columns change (an upsert would need every required column)
  const update = useUpdateRows('holdings', { silent: true })
  const [mode, setMode] = useState<Mode>('unit')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  // a screenshot of the broker app: picked, pasted or dropped, then read on this device
  const [scanFile, setScanFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { dragging } = useScreenshotIntake(setScanFile, holdings.length > 0 && !scanFile)
  const pickScreenshot = () => {
    setScanFile(null)
    fileRef.current?.click()
  }
  // the reader holds a lot of memory; let it go when leaving the page
  useEffect(() => () => void releaseOcrWorker(), [])

  /** New per-unit price for a holding, or null when nothing valid was typed (a blank field means "same as before"). */
  const newPrice = (h: Holding): Decimal | null => {
    const n = parseAmount(typed[h.id])
    if (!n || n.isNegative()) return null
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
  // what the scan read goes into the fields (per unit), on top of anything already typed; saving stays the one way to change a price
  const applyScan = (prices: Record<string, string>) => {
    const next: Record<string, string> = {}
    for (const h of holdings) {
      const p = newPrice(h)
      if (p !== null) next[h.id] = p.toDecimalPlaces(6).toString()
    }
    Object.assign(next, prices)
    setTyped(next)
    setMode('unit')
    setScanFile(null)
    const n = Object.keys(prices).length
    toast.success(`Filled ${n} price${n === 1 ? '' : 's'} · check them and save`)
    const first = holdings.findIndex((h) => prices[h.id])
    if (first >= 0) setTimeout(() => inputs.current[first]?.focus({ preventScroll: false }), 50)
  }

  const changed = holdings.filter(hasMoved)
  // something typed that isn't a price: don't save (and mark every price as checked) until it's fixed
  const badEntry = (h: Holding) => Boolean(typed[h.id]?.trim()) && newPrice(h) === null
  const invalid = holdings.some(badEntry)
  const freshCount = holdings.filter((h) => isPriceFresh(h.price_updated_at)).length

  const before = holdings.reduce((a, h) => a.plus(toDisplayOrZero(d(h.units).times(d(h.current_price)), h.currency)), d(0))
  const after = holdings.reduce((a, h) => a.plus(toDisplayOrZero(d(h.units).times(newPrice(h) ?? d(h.current_price)), h.currency)), d(0))
  const delta = after.minus(before)

  const save = async () => {
    if (!holdings.length || invalid) return
    const now = new Date().toISOString()
    const changedIds = new Set(changed.map((h) => h.id))
    await update.mutateAsync(
      holdings.map((h) =>
        changedIds.has(h.id) ? { id: h.id, current_price: newPrice(h)!.toFixed(6), price_updated_at: now } : { id: h.id, price_updated_at: now },
      ),
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
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Scan a screenshot" onClick={pickScreenshot}>
                <ScanLine className="h-5 w-5" />
              </Button>
              <Button size="sm" onClick={save} loading={update.isPending} disabled={invalid}>
                {changed.length ? `Save (${changed.length})` : 'Done'}
              </Button>
            </div>
          ) : undefined
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) setScanFile(f)
          e.target.value = ''
        }}
      />
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 p-6">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent px-10 py-8 text-center">
            <ImagePlus className="h-8 w-8 text-accent" />
            <span className="text-base font-semibold">Drop the screenshot here</span>
          </div>
        </div>
      ) : null}

      {!holdings.length ? (
        <Card padded className="text-muted text-sm">
          No open stocks or funds. Add one from Investments.
        </Card>
      ) : (
        <div className="space-y-5">
          <Card padded>
            {/* the change (or hint) moves under the total when both don't fit on one line */}
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div>
                <div className="text-muted text-xs font-medium">Stocks &amp; funds</div>
                <Amount value={after} currency={display} size="lg" className="mt-1 block" />
              </div>
              {changed.length ? (
                <div className={cn('shrink-0 text-right text-sm font-semibold', delta.gte(0) ? 'text-positive' : 'text-negative')}>
                  <Amount value={delta} currency={display} showSign />
                  {!before.isZero() ? <div className="text-xs font-medium">{formatPercent(delta.div(before).times(100))}</div> : null}
                </div>
              ) : (
                <span className="text-muted shrink-0 text-xs">Type only what moved</span>
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
            <button type="button" onClick={pickScreenshot} className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-surface-2 active:bg-surface-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <ScanLine className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">Scan a screenshot of your broker app</span>
                <span className="mt-0.5 block text-[13px] text-muted">Read on this device, never uploaded. Or paste one here.</span>
              </span>
              <ChevronRight className="-mr-1 h-4 w-4 shrink-0 text-faint" />
            </button>
          </Card>

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
                        {h.ticker ? <span className="text-muted ml-1.5 text-xs font-normal">{h.ticker}</span> : null}
                      </span>
                      <span className="text-muted mt-1 block truncate text-xs">
                        {mode === 'unit' ? <Amount value={was} currency={h.currency} size="sm" /> : privacy ? '**** units' : `${d(h.units).toString()} units`}
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
                        className={cn('tnum h-11 text-right', moved && 'border-accent', badEntry(h) && 'border-negative')}
                        aria-invalid={badEntry(h)}
                        placeholder={privacy ? '' : mode === 'unit' ? was.toFixed(2) : was.times(d(h.units)).toFixed(2)}
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
                      <span
                        className={cn(
                          'mt-1 h-4 text-[11px] font-medium whitespace-nowrap',
                          pct?.gt(0) ? 'text-positive' : pct?.lt(0) ? 'text-negative' : 'text-faint',
                        )}
                      >
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

          <Button full size="lg" onClick={save} loading={update.isPending} disabled={invalid}>
            {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Mark all as checked'}
          </Button>
        </div>
      )}
      <ScanPricesSheet file={scanFile} holdings={holdings} onClose={() => setScanFile(null)} onApply={applyScan} onPickAnother={pickScreenshot} />
    </div>
  )
}
