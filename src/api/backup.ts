import { supabase } from '@/api/supabase'
import { ALL_TABLES } from '@/api/queries'
import { downloadFile, toCsv } from '@/utils'
import type { TableName } from '@/api/database.types'

/**
 * Parents before children: debts and debt payments reference transactions, payouts reference
 * certificates (whose schedule the database regenerates on insert), so those come last.
 */
const IMPORT_ORDER: TableName[] = [
  'currencies', 'settings', 'accounts', 'sub_accounts', 'categories', 'tags', 'contacts', 'investment_categories',
  'exchange_rates', 'gold_prices', 'certificates', 'holdings', 'gold_items', 'recurring_transactions', 'budgets',
  'transactions', 'debts', 'debt_payments', 'holding_sales', 'certificate_payouts', 'net_worth_snapshots',
]

/** Rows that can already exist under another id are matched on their natural key instead. */
const ON_CONFLICT: Partial<Record<TableName, string>> = {
  currencies: 'user_id,code',
  settings: 'user_id',
  exchange_rates: 'user_id,quote,rate_date',
  certificate_payouts: 'certificate_id,due_date',
  net_worth_snapshots: 'user_id,snapshot_date',
  budgets: 'user_id,category_id',
}

/** Append-only history: rows already present are skipped, never updated. */
const INSERT_ONLY = new Set<TableName>(['gold_prices'])

/** Columns the database computes itself; never re-import them. */
const SKIP_COLUMNS: Partial<Record<TableName, string[]>> = {
  sub_accounts: ['balance'],
}

export async function fetchAllTables(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of ALL_TABLES) {
     
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
  if ((parsed.app !== 'financial-tracker' && parsed.app !== 'finboard') || !parsed.tables) throw new Error('This file is not a FinBoard backup')
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
       
      const q = (supabase as any).from(table)
      const conflict = ON_CONFLICT[table]
      const { error } = INSERT_ONLY.has(table)
        ? await q.upsert(chunk, { ignoreDuplicates: true })
        : conflict
          ? await q.upsert(chunk, { onConflict: conflict })
          : await q.upsert(chunk)
      if (error) throw new Error(`${table}: ${error.message}. Nothing is lost: fix the file or try again, restoring is safe to repeat.`)
      count += chunk.length
    }
  }
  // balances are trigger-maintained; recompute from imported transactions
  const { data: subs } = await supabase.from('sub_accounts').select('id')
  for (const s of subs ?? []) await supabase.rpc('recompute_sub_account_balance', { p_sub_account_id: s.id })
  await removeUnusedDefaultDuplicates(parsed.tables)
  return count
}

/**
 * A new account starts with default categories, a Cash and a Thndr account. After restoring a
 * backup those appear twice. Remove only the ones that duplicate a restored item by name and
 * have never been used, so nothing with data attached is ever deleted.
 */
async function removeUnusedDefaultDuplicates(tables: Record<string, Record<string, unknown>[]>) {
  const key = (...parts: unknown[]) => parts.map((p) => String(p ?? '').toLowerCase()).join('|')

  const backupCats = tables.categories ?? []
  if (backupCats.length) {
    const ids = new Set(backupCats.map((c) => c.id))
    const names = new Set(backupCats.map((c) => key(c.kind, c.name)))
    const { data: cats } = await supabase.from('categories').select('id,kind,name')
    const candidates = (cats ?? []).filter((c) => !ids.has(c.id) && names.has(key(c.kind, c.name))).map((c) => c.id)
    if (candidates.length) {
      const [{ data: tx }, { data: bud }, { data: rec }, { data: kids }] = await Promise.all([
        supabase.from('transactions').select('category_id').in('category_id', candidates),
        supabase.from('budgets').select('category_id').in('category_id', candidates),
        supabase.from('recurring_transactions').select('category_id').in('category_id', candidates),
        supabase.from('categories').select('parent_id').in('parent_id', candidates),
      ])
      const used = new Set([...(tx ?? []), ...(bud ?? []), ...(rec ?? [])].map((r) => r.category_id).concat((kids ?? []).map((k) => k.parent_id)))
      const unused = candidates.filter((id) => !used.has(id))
      if (unused.length) await supabase.from('categories').delete().in('id', unused)
    }
  }

  const backupAccounts = tables.accounts ?? []
  if (backupAccounts.length) {
    const ids = new Set(backupAccounts.map((a) => a.id))
    const names = new Set(backupAccounts.map((a) => key(a.name)))
    const { data: accounts } = await supabase.from('accounts').select('id,name')
    for (const a of (accounts ?? []).filter((x) => !ids.has(x.id) && names.has(key(x.name)))) {
      const { data: subs } = await supabase.from('sub_accounts').select('id,balance,opening_balance').eq('account_id', a.id)
      const subIds = (subs ?? []).map((s) => s.id)
      const empty = (subs ?? []).every((s) => Number(s.balance) === 0 && Number(s.opening_balance) === 0)
      if (!empty) continue
      if (subIds.length) {
        const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).or(`sub_account_id.in.(${subIds.join(',')}),to_sub_account_id.in.(${subIds.join(',')})`)
        if (count) continue
      }
      const [{ count: holdings }, { count: certs }] = await Promise.all([
        supabase.from('holdings').select('id', { count: 'exact', head: true }).eq('account_id', a.id),
        supabase.from('certificates').select('id', { count: 'exact', head: true }).eq('account_id', a.id),
      ])
      if (!holdings && !certs) await supabase.from('accounts').delete().eq('id', a.id)
    }
  }

  const backupInv = tables.investment_categories ?? []
  if (backupInv.length) {
    const ids = new Set(backupInv.map((c) => c.id))
    const names = new Set(backupInv.map((c) => key(c.name)))
    const { data: inv } = await supabase.from('investment_categories').select('id,name')
    const candidates = (inv ?? []).filter((c) => !ids.has(c.id) && names.has(key(c.name))).map((c) => c.id)
    if (candidates.length) {
      const { data: used } = await supabase.from('holdings').select('category_id').in('category_id', candidates)
      const usedIds = new Set((used ?? []).map((h) => h.category_id))
      const unused = candidates.filter((id) => !usedIds.has(id))
      if (unused.length) await supabase.from('investment_categories').delete().in('id', unused)
    }
  }
}
