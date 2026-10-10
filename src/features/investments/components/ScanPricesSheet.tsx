import { useEffect, useMemo, useState } from 'react'
import { Check, ImageOff, ScanLine } from 'lucide-react'
import { Button, Card, Divider, Input, ProgressBar, Segmented, Select, Sheet } from '@/components/ui'
import { Amount } from '@/components/shared'
import { useConvert } from '@/hooks/useMoney'
import { usePrefs } from '@/store/prefs'
import { d, parseAmount } from '@/domain/money'
import { formatPercent } from '@/domain/format'
import { maskNumbers } from '@/domain/privacy'
import { interpret, scanPrices, type ScanKind, type ScanMatch, type ScanResult, type ScanRow } from '@/domain/priceScan'
import { prepareScreenshot, ScanImageError } from '@/ocr/preprocess'
import { ocrAssetsCached, recognizeScreenshot, type OcrProgress } from '@/ocr/worker'
import { cn } from '@/utils'
import type { Holding } from '@/api/database.types'

type Stage = { kind: 'reading'; progress: OcrProgress | null } | { kind: 'review'; result: ScanResult } | { kind: 'error'; code: ErrorCode }
type ErrorCode = 'nothing' | 'offline' | 'reader' | 'too-large' | 'not-image'

const ERRORS: Record<ErrorCode, { title: string; detail: string }> = {
  nothing: { title: 'Couldn’t read any prices', detail: 'Try a sharper screenshot with your list of holdings in view, or crop it to the list.' },
  offline: { title: 'The reader needs a one-time download', detail: 'About 7 MB, kept on this device afterwards. Connect to the internet and try again.' },
  reader: { title: 'The reader couldn’t start', detail: 'Try again in a moment.' },
  'too-large': { title: 'That picture is too big to read here', detail: 'Crop it to the list of holdings and try again.' },
  'not-image': { title: 'That file isn’t a picture', detail: 'Pick a screenshot (PNG or JPG).' },
}

/** A row on the review screen: a match, plus what the person changed about it. */
interface ReviewRow {
  match: ScanMatch
  holding: Holding
  included: boolean
  kind: ScanKind
  /** the new price per unit, as text so it can be edited */
  text: string
}

const priceText = (v: { toDecimalPlaces: (n: number) => { toString: () => string } }) => v.toDecimalPlaces(4).toString()

/**
 * Reads a screenshot of a broker app and shows what it found, holding by holding, for a quick check
 * before the prices go into the Update prices screen. The picture never leaves this device, and
 * nothing is saved from here: Apply only fills in the fields.
 */
export function ScanPricesSheet({
  file,
  holdings,
  onClose,
  onApply,
  onPickAnother,
  initialResult,
}: {
  file: File | null
  /** open holdings, as on the page */
  holdings: Holding[]
  onClose: () => void
  /** per-unit prices by holding id, as typed text */
  onApply: (prices: Record<string, string>) => void
  onPickAnother: () => void
  /** skips the reading (tests and previews) */
  initialResult?: ScanResult
}) {
  const open = Boolean(file) || Boolean(initialResult)
  const privacy = usePrefs((s) => s.privacy)
  const { toDisplayOrZero, display } = useConvert()
  const [stage, setStage] = useState<Stage>(initialResult ? { kind: 'review', result: initialResult } : { kind: 'reading', progress: null })
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [unmatched, setUnmatched] = useState<ScanRow[]>([])
  const [thumb, setThumb] = useState<string | null>(null)
  const byId = useMemo(() => new Map(holdings.map((h) => [h.id, h])), [holdings])

  const showResult = (result: ScanResult) => {
    setRows(
      result.matches
        .filter((m) => byId.has(m.holdingId))
        .map((m) => ({ match: m, holding: byId.get(m.holdingId)!, included: m.confidence !== 'low', kind: m.kind, text: priceText(m.price) })),
    )
    setUnmatched(result.unmatched)
    setStage(result.matches.length || result.unmatched.length ? { kind: 'review', result } : { kind: 'error', code: 'nothing' })
  }

  // a thumbnail of the picture, for the reading step
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setThumb(url)
    return () => {
      URL.revokeObjectURL(url)
      setThumb(null)
    }
  }, [file])

  // read the picture when one arrives
  useEffect(() => {
    if (initialResult) {
      showResult(initialResult)
      return
    }
    if (!file) return
    let cancelled = false
    setStage({ kind: 'reading', progress: null })
    ;(async () => {
      try {
        if (!navigator.onLine && !(await ocrAssetsCached())) throw new Error('offline')
        const prepared = await prepareScreenshot(file)
        if (cancelled) return
        const words = await recognizeScreenshot(prepared.png, (progress) => {
          if (!cancelled) setStage({ kind: 'reading', progress })
        })
        if (cancelled) return
        showResult(scanPrices(words, holdings))
      } catch (e) {
        if (cancelled) return
        const code: ErrorCode = e instanceof ScanImageError ? (e.code === 'decode' ? 'not-image' : e.code) : (e as Error)?.message === 'offline' || (!navigator.onLine && !(await ocrAssetsCached())) ? 'offline' : 'reader'
        setStage({ kind: 'error', code })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, initialResult])

  const setRow = (i: number, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setKind = (i: number, kind: ScanKind) => {
    const r = rows[i]!
    setRow(i, { kind, text: priceText(interpret(r.match.value, r.holding, kind).price) })
  }
  const assign = (row: ScanRow, holdingId: string) => {
    const h = byId.get(holdingId)
    if (!h) return
    const it = interpret(row.value, h)
    const match: ScanMatch = { ...row, holdingId, kind: it.kind, price: it.price, ambiguous: it.ambiguous, confidence: 'medium', reason: 'Picked by you' }
    setRows((rs) => [...rs.filter((r) => r.holding.id !== holdingId), { match, holding: h, included: true, kind: it.kind, text: priceText(it.price) }])
    setUnmatched((u) => u.filter((x) => x !== row))
  }

  const newPrice = (r: ReviewRow) => {
    const n = parseAmount(r.text)
    return n && n.gt(0) ? n : null
  }
  const ready = rows.filter((r) => r.included && newPrice(r))
  const broken = rows.some((r) => r.included && !newPrice(r))
  const before = holdings.reduce((a, h) => a.plus(toDisplayOrZero(d(h.units).times(d(h.current_price)), h.currency)), d(0))
  const after = holdings.reduce((a, h) => {
    const r = ready.find((x) => x.holding.id === h.id)
    return a.plus(toDisplayOrZero(d(h.units).times(r ? newPrice(r)! : d(h.current_price)), h.currency))
  }, d(0))
  const delta = after.minus(before)
  const notFound = holdings.filter((h) => !rows.some((r) => r.holding.id === h.id))
  const apply = () => {
    onApply(Object.fromEntries(ready.map((r) => [r.holding.id, newPrice(r)!.toString()])))
  }

  const progressCopy = (p: OcrProgress | null) =>
    !p ? 'Getting the picture ready…' : p.stage === 'download' ? `Downloading the reader (one time, about 7 MB)… ${p.percent}%` : p.stage === 'init' ? 'Starting the reader…' : `Reading the screenshot… ${p.percent}%`
  const title = stage.kind === 'review' ? 'Check what was read' : 'Scan prices'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        stage.kind === 'review' ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onPickAnother}>
              Try another
            </Button>
            <Button className="flex-1" onClick={apply} disabled={!ready.length || broken}>
              {broken ? 'Fix the number first' : ready.length ? `Apply ${ready.length} price${ready.length === 1 ? '' : 's'}` : 'Nothing ticked'}
            </Button>
          </div>
        ) : stage.kind === 'error' ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <Button className="flex-1" onClick={onPickAnother}>
              Try another
            </Button>
          </div>
        ) : (
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
        )
      }
    >
      {stage.kind === 'reading' ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-surface-2">
            {thumb && !privacy ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <ScanLine className="h-8 w-8 text-accent" />}
          </span>
          <div className="w-full space-y-2">
            <p className="text-sm text-muted" aria-live="polite">
              {progressCopy(stage.progress)}
            </p>
            <ProgressBar value={stage.progress?.stage === 'recognize' ? 60 + stage.progress.percent * 0.4 : stage.progress?.stage === 'init' ? 55 : (stage.progress?.percent ?? 0) * 0.5} />
          </div>
          <p className="text-xs text-faint">Read on this device. The picture is never uploaded or kept.</p>
        </div>
      ) : stage.kind === 'error' ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-2 text-muted">
            <ImageOff className="h-7 w-7" />
          </span>
          <h3 className="text-base font-semibold">{ERRORS[stage.code].title}</h3>
          <p className="max-w-xs text-sm text-muted">{ERRORS[stage.code].detail}</p>
        </div>
      ) : (
        <div className="space-y-5 pb-2">
          <Card padded className="bg-surface-2">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div>
                <div className="text-xs font-medium text-muted">
                  Read {rows.length} of {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                </div>
                <Amount value={after} currency={display} size="lg" className="mt-1 block" />
              </div>
              {ready.length ? (
                <div className={cn('shrink-0 text-right text-sm font-semibold', delta.gte(0) ? 'text-positive' : 'text-negative')}>
                  <Amount value={delta} currency={display} showSign />
                  {!before.isZero() ? <div className="text-xs font-medium">{formatPercent(delta.div(before).times(100))}</div> : null}
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted">Untick anything that looks wrong, or fix the number. Doubtful rows start unticked.</p>
          </Card>

          {rows.length ? (
            <Card className="overflow-hidden">
              {rows.map((r, i) => {
                const n = newPrice(r)
                const was = d(r.holding.current_price)
                const pct = n && !was.isZero() ? n.minus(was).div(was).times(100) : null
                const bad = r.included && !n
                return (
                  <div key={r.holding.id}>
                    {i > 0 ? <Divider /> : null}
                    <div className={cn('px-4 py-3.5', !r.included && 'opacity-60')}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={r.included}
                          aria-label={`Use the price read for ${r.holding.name}`}
                          onClick={() => setRow(i, { included: !r.included })}
                          className={cn('flex h-11 w-7 shrink-0 items-center justify-start', '-ml-1')}
                        >
                          <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg border-2', r.included ? 'border-accent bg-accent text-white' : 'border-border')}>
                            {r.included ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                          </span>
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">
                            {r.holding.name}
                            {r.holding.ticker ? <span className="ml-1.5 text-xs font-normal text-muted">{r.holding.ticker}</span> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            was <Amount value={was} currency={r.holding.currency} size="sm" />
                          </span>
                          <span className={cn('mt-0.5 block text-[11px] leading-4', r.match.confidence === 'low' ? 'text-warning' : 'text-faint')}>{privacy ? maskNumbers(r.match.reason) : r.match.reason}</span>
                        </span>
                        <span className="flex w-28 shrink-0 flex-col items-end">
                          <Input
                            inputMode="decimal"
                            aria-label={`New price for ${r.holding.name}`}
                            aria-invalid={bad}
                            className={cn('tnum h-11 text-right', bad && 'border-negative')}
                            value={privacy && !r.included ? '' : r.text}
                            onChange={(e) => setRow(i, { text: e.target.value, included: true })}
                          />
                          <span className={cn('mt-1 h-4 text-[11px] font-medium whitespace-nowrap', pct?.gt(0) ? 'text-positive' : pct?.lt(0) ? 'text-negative' : 'text-faint')}>
                            {pct ? formatPercent(pct) : bad ? 'Not a number' : 'Same as before'}
                          </span>
                        </span>
                      </div>
                      {r.match.ambiguous ? (
                        <Segmented<ScanKind>
                          value={r.kind}
                          onChange={(k) => setKind(i, k)}
                          options={[
                            { value: 'unit', label: 'Price per unit' },
                            { value: 'total', label: 'Total value' },
                          ]}
                          className="mt-2.5 ml-9"
                        />
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </Card>
          ) : null}

          {unmatched.length ? (
            <div>
              <h3 className="mb-2 px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Not matched</h3>
              <Card className="overflow-hidden">
                {unmatched.map((u, i) => (
                  <div key={`${u.label}-${u.y}`}>
                    {i > 0 ? <Divider /> : null}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{u.label}</span>
                        <span className="block text-xs text-muted">{privacy ? '****' : u.raw}</span>
                      </span>
                      <Select aria-label={`Holding for ${u.label}`} value="" onChange={(e) => assign(u, e.target.value)} className="h-10 w-40 text-sm">
                        <option value="">Pick holding…</option>
                        {holdings.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.ticker ? `${h.ticker} · ${h.name}` : h.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}

          {notFound.length ? (
            <p className="px-1 text-xs text-muted">
              Not in the screenshot: {notFound.map((h) => h.ticker ?? h.name).join(', ')}. {notFound.length === 1 ? 'It keeps its' : 'They keep their'} last price.
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}
