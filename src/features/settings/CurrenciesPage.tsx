import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Card, Divider, Field, Input, Sheet, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { useCurrencies, useSettings } from '@/api/queries'
import { useUpsert } from '@/api/mutations'
import { useUserId } from '@/app/providers/AuthProvider'

export default function CurrenciesPage() {
  const { data: currencies } = useCurrencies()
  const { data: settings } = useSettings()
  const upsert = useUpsert('currencies', { silent: true, invalidate: ['exchange_rates'] })
  const userId = useUserId()
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState('2')

  const add = async () => {
    const c = code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(c) || !userId) return
    await upsert.mutateAsync([{ user_id: userId, code: c, name: name.trim() || c, symbol: symbol.trim() || c, decimals: Math.min(4, Math.max(0, parseInt(decimals) || 2)), is_active: true, sort_order: (currencies?.length ?? 0) + 1 }])
    setAdding(false)
    setCode('')
    setName('')
    setSymbol('')
  }

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title="Currencies"
        subtitle="Active currencies appear in forms and the display toggle"
        action={
          <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      <Card className="overflow-hidden px-5">
        {(currencies ?? []).map((c, i) => (
          <div key={c.code}>
            {i > 0 ? <Divider className="mx-0" /> : null}
            <Toggle
              checked={c.is_active}
              onChange={(v) => {
                if (!v && c.code === settings?.base_currency) return
                void upsert.mutateAsync([{ user_id: c.user_id, code: c.code, is_active: v }])
              }}
              label={`${c.code} · ${c.symbol}`}
              description={c.name + (c.code === settings?.base_currency ? ' · base currency' : '')}
            />
          </div>
        ))}
      </Card>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add currency" footer={<Button full size="lg" onClick={add} disabled={!/^[A-Za-z]{3}$/.test(code)}>Add</Button>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code" hint="ISO code, e.g. EUR">
            <Input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" className="uppercase" />
          </Field>
          <Field label="Symbol">
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="€" />
          </Field>
          <Field label="Name" className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Euro" />
          </Field>
          <Field label="Decimals">
            <Input inputMode="numeric" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  )
}
