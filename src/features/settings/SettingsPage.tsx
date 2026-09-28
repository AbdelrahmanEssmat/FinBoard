import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Coins, Download, Moon, RefreshCw, Sun, Contrast, Upload, Monitor, Eye, Smartphone } from 'lucide-react'
import { Button, Card, ConfirmDialog, Divider, Field, Segmented, Select, Toggle } from '@/components/ui'
import { ListRow, PageHeader, SectionTitle } from '@/components/shared'
import { useCurrencies, useSettings } from '@/api/queries'
import { useUpsert } from '@/api/mutations'
import { usePrefs, type ThemePref } from '@/store/prefs'
import { useAuth, useUserId } from '@/app/providers/AuthProvider'
import { exportAll, exportTransactionsCsv, importAll } from '@/api/backup'
import { toast } from '@/store/toasts'
import { AccountSection } from './AccountSection'

export default function SettingsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: currencies } = useCurrencies()
  const upsertSettings = useUpsert('settings', { silent: true })
  const { privacy, setPrivacy, theme, setTheme, setDisplayCurrency } = usePrefs()
  const { session } = useAuth()
  const userId = useUserId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importConfirm, setImportConfirm] = useState<File | null>(null)

  const setBase = async (code: string) => {
    if (!userId) return
    await upsertSettings.mutateAsync([{ user_id: userId, base_currency: code }])
    setDisplayCurrency(null)
  }

  const doExport = async (kind: 'json' | 'csv') => {
    setBusy(kind)
    try {
      if (kind === 'json') await exportAll()
      else await exportTransactionsCsv()
      toast.success('Export ready')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (file: File) => {
    setBusy('import')
    try {
      const n = await importAll(file)
      await qc.invalidateQueries()
      toast.success(`Imported ${n} records`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="anim-fade-up space-y-8">
      <PageHeader
        back
        title="Settings"
        subtitle={session?.user.email}
      />

      <section>
        <SectionTitle>Money</SectionTitle>
        <Card padded className="space-y-5">
          <Field label="Base currency" hint="Totals and net worth are shown in this currency by default">
            <Select value={settings?.base_currency ?? 'EGP'} onChange={(e) => void setBase(e.target.value)}>
              {(currencies ?? []).filter((c) => c.is_active).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Divider />
          {/* rows run edge to edge of the card; their own padding lines the icons up with the field above */}
          <ListRow icon={Coins} color="#eab308" title="Currencies" subtitle="Add or enable EUR, SAR, AED…" chevron onClick={() => navigate('/settings/currencies')} className="-mx-5 w-[calc(100%+2.5rem)] sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6" />
          <ListRow icon={RefreshCw} color="#2563eb" title="Exchange rates" subtitle="Live rates and manual overrides" chevron onClick={() => navigate('/settings/rates')} className="-mx-5 w-[calc(100%+2.5rem)] sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 -mt-4" />
        </Card>
      </section>

      <section>
        <SectionTitle>Appearance</SectionTitle>
        <Card padded className="space-y-4">
          <Field label="Theme">
            <Segmented
              value={theme}
              onChange={(t: ThemePref) => setTheme(t)}
              options={[
                { value: 'system', label: <span className="flex items-center justify-center gap-1"><Monitor className="hidden h-4 w-4 shrink-0 min-[380px]:block" /> Auto</span> },
                { value: 'light', label: <span className="flex items-center justify-center gap-1"><Sun className="hidden h-4 w-4 shrink-0 min-[380px]:block" /> Light</span> },
                { value: 'mid', label: <span className="flex items-center justify-center gap-1"><Contrast className="hidden h-4 w-4 shrink-0 min-[380px]:block" /> Mid</span> },
                { value: 'dark', label: <span className="flex items-center justify-center gap-1"><Moon className="hidden h-4 w-4 shrink-0 min-[380px]:block" /> Dark</span> },
              ]}
            />
          </Field>
          <Toggle checked={privacy} onChange={setPrivacy} label="Hide amounts" description="Blur every number until you tap the eye icon" />
        </Card>
      </section>

      <section>
        <SectionTitle>Backup</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={Download} color="#16a34a" title="Export everything (JSON)" subtitle="Full backup you can restore later" onClick={() => void doExport('json')} trailing={busy === 'json' ? <span className="text-xs text-muted">…</span> : null} />
          <Divider />
          <ListRow icon={Download} color="#0ea5e9" title="Export transactions (CSV)" subtitle="Open in Excel or Numbers" onClick={() => void doExport('csv')} />
          <Divider />
          <ListRow icon={Upload} color="#f97316" title="Restore from JSON" subtitle="Merges a backup into this account" onClick={() => fileRef.current?.click()} trailing={busy === 'import' ? <span className="text-xs text-muted">…</span> : null} />
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportConfirm(f); e.target.value = '' }} />
        </Card>
      </section>

      <section>
        <SectionTitle>Install</SectionTitle>
        <Card padded className="text-sm leading-relaxed text-muted">
          <p className="flex items-start gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> <span><b className="text-text">iPhone:</b> open this site in Safari → Share → <b className="text-text">Add to Home Screen</b>.</span></p>
          <p className="mt-2 flex items-start gap-2"><Monitor className="mt-0.5 h-4 w-4 shrink-0" /> <span><b className="text-text">Windows:</b> in Chrome or Edge click the install icon in the address bar, or menu → <b className="text-text">Install app</b>.</span></p>
        </Card>
      </section>

      <AccountSection />

      <Card className="overflow-hidden">
        <ListRow icon={Eye} color="#64748b" title="Privacy" subtitle="Only you can see your data" />
      </Card>
      <p className="text-center text-xs text-faint">FinBoard · v{__APP_VERSION__}</p>

      <ConfirmDialog
        open={Boolean(importConfirm)}
        onClose={() => setImportConfirm(null)}
        title="Restore this backup?"
        message="Records with the same IDs are overwritten; everything else is kept."
        confirmLabel="Restore"
        danger={false}
        onConfirm={() => importConfirm && void doImport(importConfirm)}
      />
      <Button variant="ghost" className="hidden" />
    </div>
  )
}
