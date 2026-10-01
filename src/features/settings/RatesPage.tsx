import { useState } from 'react'
import { Pencil, RefreshCw } from 'lucide-react'
import { Button, Card, Divider, Field, Input, Pill, Sheet } from '@/components/ui'
import { ListRow, PageHeader } from '@/components/shared'
import { useBaseCurrency, useCurrenciesInUse, useRateTable } from '@/hooks/useMoney'
import { useUpsert } from '@/api/mutations'
import { useRates } from '@/api/queries'
import { useUserId } from '@/app/providers/AuthProvider'
import { newId } from '@/utils/ids'
import { crossRate } from '@/domain/currency'
import { d, type Decimal } from '@/domain/money'
import { formatDate, todayIso } from '@/domain/format'
import { relativeTime } from '@/utils'
import { refreshRatesFromClient } from '@/api/ratesProvider'
import { toast } from '@/store/toasts'

export default function RatesPage() {
  const base = useBaseCurrency()
  const currencies = useCurrenciesInUse()
  const { rates, updatedAt, provider } = useRateTable()
  const { data: rows } = useRates()
  const upsert = useUpsert('exchange_rates')
  const userId = useUserId()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const today = todayIso()

  const others = currencies.filter((c) => c.code !== base)
  /**
   * Rates are stored as "1 USD = rate QUOTE", and USD itself is always 1. So an override of
   * USD while the base is, say, EGP is stored as a rate for the base currency (1 USD = 1/X EGP).
   */
  const storedQuote = (code: string) => (code === 'USD' && base !== 'USD' ? base : code)
  const manualToday = (code: string) => rows?.find((r) => r.quote === storedQuote(code) && r.user_id && r.rate_date === today && r.source === 'manual')

  const saveOverride = async () => {
    if (!editing || !userId || !d(value).gt(0)) return
    // the user enters "1 base = X editing"
    const x = d(value)
    let quote = editing
    let usdRate: Decimal
    if (base === 'USD') {
      usdRate = x // 1 USD = X quote
    } else if (editing === 'USD') {
      quote = base
      usdRate = d(1).div(x) // 1 base = X USD  ⇒  1 USD = 1/X base
    } else {
      const baseUsd = rates[base] ? d(rates[base]) : null
      if (!baseUsd || !baseUsd.gt(0)) {
        toast.error(`Set a rate for USD first, so ${editing} can be converted`)
        return
      }
      usdRate = x.times(baseUsd) // 1 USD = baseUsd base = baseUsd·X quote
    }
    // today's row for this currency (automatic or an earlier manual one): there is one per day, so update it
    const existing = rows?.find((r) => r.quote === quote && r.user_id === userId && r.rate_date === today)
    await upsert.mutateAsync([{ id: existing?.id ?? newId(), user_id: userId, quote, rate: usdRate.toFixed(8), rate_date: today, source: 'manual', provider: 'manual', fetched_at: new Date().toISOString() }])
    setEditing(null)
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      const n = await refreshRatesFromClient(currencies.map((c) => c.code), userId, { force: true })
      toast.success(n ? `Updated ${n} rate${n === 1 ? '' : 's'}` : 'Rates already up to date')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not fetch rates')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Exchange rates"
        subtitle={updatedAt ? `Updated ${relativeTime(updatedAt)}${provider ? ' · ' + provider : ''}` : 'No automatic rates yet'}
        action={
          <Button size="sm" variant="soft" onClick={refresh} loading={refreshing}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {others.map((c, i) => {
          const r = crossRate(base, c.code, rates)
          const inverse = crossRate(c.code, base, rates)
          const manual = manualToday(c.code)
          return (
            <div key={c.code}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={
                  <span className="flex items-center gap-2">
                    1 {base} = <span className="tnum">{r ? r.toFixed(4) : '—'}</span> {c.code}
                    {manual ? <Pill tone="accent">manual today</Pill> : null}
                  </span>
                }
                subtitle={inverse ? `1 ${c.code} = ${inverse.toFixed(4)} ${base}` : 'No rate — add one manually'}
                trailing={<Pencil className="h-4 w-4 text-faint" />}
                onClick={() => {
                  setEditing(c.code)
                  setValue(r ? r.toFixed(4) : '')
                }}
              />
            </div>
          )
        })}
        {!others.length ? <p className="p-5 text-sm text-muted">Enable another currency first.</p> : null}
      </Card>
      <p className="mt-3 px-1 text-xs text-faint">Automatic rates come from open.er-api.com (ExchangeRate-API), which publishes new rates once a day; the app checks for them when you open it and every few hours. A manual rate for today wins over the automatic one until tomorrow’s update. Historical net worth always uses the rate that applied on each day.</p>

      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={`Override ${editing}`} footer={<Button full size="lg" onClick={saveOverride} loading={upsert.isPending} disabled={!d(value).gt(0)}>Save for {formatDate(today)}</Button>}>
        <Field label={`1 ${base} equals`} hint={`Enter how many ${editing} you get for one ${base}`}>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" className="tnum" value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="text-sm font-medium text-muted">{editing}</span>
          </div>
        </Field>
      </Sheet>
    </div>
  )
}
