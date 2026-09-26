import { supabase } from '@/lib/supabase'
import { ALL_TABLES } from '@/lib/data/tables'
import { downloadFile, toCsv } from '@/lib/utils'
import type { TableName } from '@/lib/database.types'

const IMPORT_ORDER: TableName[] = [
  'currencies', 'settings', 'accounts', 'sub_accounts', 'categories', 'tags', 'contacts', 'investment_categories',
  'exchange_rates', 'gold_prices', 'certificates', 'holdings', 'gold_items', 'debts', 'recurring_transactions', 'budgets',
  'transactions', 'debt_payments', 'certificate_payouts', 'net_worth_snapshots',
]

/** Columns the database computes itself; never re-import them. */
const SKIP_COLUMNS: Partial<Record<TableName, string[]>> = {
  sub_accounts: ['balance'],
}

export async function fetchAllTables(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of ALL_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from(table).select('*').limit(50000)
    if (error) throw error
    out[table] = data ?? []
  }
  return out
}

export async function exportAll() {
  const tables = await fetchAllTables()
  const payload = { app: 'financial-tracker', version: 1, exported_at: new Date().toISOString(), tables }
  downloadFile(`finance-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2))
}

export async function exportTransactionsCsv() {
  const { data: txs, error } = await supabase.from('transactions').select('*').order('date', { ascending: false }).limit(50000)
  if (error) throw error
  const { data: subs } = await supabase.from('sub_accounts').select('*')
  const { data: accounts } = await supabase.from('accounts').select('*')
  const { data: cats } = await supabase.from('categories').select('*')
  const subName = (id: string | null) => {
    const s = subs?.find((x) => x.id === id)
    const a = s ? accounts?.find((x) => x.id === s.account_id) : undefined
    return s ? `${a?.name ?? ''} ${s.currency}${s.name ? ' ' + s.name : ''}`.trim() : ''
  }
  const rows = (txs ?? []).map((t) => ({
    date: t.date,
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    account: subName(t.sub_account_id),
    to_account: subName(t.to_sub_account_id),
    to_amount: t.to_amount ?? '',
    to_currency: t.to_currency ?? '',
    category: cats?.find((c) => c.id === t.category_id)?.name ?? '',
    payee: t.payee ?? '',
    notes: t.notes ?? '',
    tags: t.tags.join('|'),
    source: t.source,
  }))
  downloadFile(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8')
}

/** Restore a JSON backup into the current account (upsert by id). Returns number of rows written. */
export async function importAll(file: File): Promise<number> {
  const text = await file.text()
  const parsed = JSON.parse(text) as { app?: string; tables?: Record<string, Record<string, unknown>[]> }
  if (parsed.app !== 'financial-tracker' || !parsed.tables) throw new Error('This file is not a Financial Tracker backup')
  const { data: userData } = await supabase.auth.getUser()
  const uid = userData.user?.id
  if (!uid) throw new Error('Not signed in')
  let count = 0
  for (const table of IMPORT_ORDER) {
    const rows = parsed.tables[table]
    if (!rows?.length) continue
    const skip = new Set(SKIP_COLUMNS[table] ?? [])
    const cleaned = rows.map((r) => {
      const copy: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) if (!skip.has(k)) copy[k] = v
      // global rate/gold rows keep user_id null; everything else becomes mine
      if (copy.user_id !== null || !(table === 'exchange_rates' || table === 'gold_prices')) copy.user_id = uid
      return copy
    })
    // exchange_rates/gold_prices global rows can't be written by a user; keep only own rows
    const writable = table === 'exchange_rates' || table === 'gold_prices' ? cleaned.filter((r) => r.user_id === uid) : cleaned
    for (let i = 0; i < writable.length; i += 500) {
      const chunk = writable.slice(i, i + 500)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = (supabase as any).from(table)
      const { error } = table === 'currencies' ? await q.upsert(chunk, { onConflict: 'user_id,code' }) : table === 'settings' ? await q.upsert(chunk, { onConflict: 'user_id' }) : await q.upsert(chunk)
      if (error) throw new Error(`${table}: ${error.message}`)
      count += chunk.length
    }
  }
  // balances are trigger-maintained; recompute from imported transactions
  const { data: subs } = await supabase.from('sub_accounts').select('id')
  for (const s of subs ?? []) await supabase.rpc('recompute_sub_account_balance', { p_sub_account_id: s.id })
  return count
}
