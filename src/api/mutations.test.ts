import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/api/supabase', () => ({ supabase: {}, isNetworkError: () => false }))
vi.mock('@/offline/mutate', () => ({ submit: vi.fn() }))
vi.mock('@/store/toasts', () => ({ toast: { info: vi.fn(), error: vi.fn() }, deleteWithUndo: vi.fn() }))

import { cacheApplyBalance, cacheRemove, cacheUpsert, invalidateRelated, RELATED_ON_DELETE, RELATED_ON_WRITE } from '@/api/mutations'

describe('related tables are refreshed', () => {
  it('a deleted transaction refreshes everything its cleanup trigger touches, once each', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    invalidateRelated(qc, 'transactions', RELATED_ON_DELETE, ['sub_accounts'])
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0])
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining(['transactions', 'sub_accounts', 'debts', 'debt_payments', 'holdings', 'holding_sales', 'card_installment_plans', 'certificate_payouts']))
  })
  it('editing a debt refreshes the linked transaction and balance', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    invalidateRelated(qc, 'debts', RELATED_ON_WRITE)
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0])).toEqual(['debts', 'transactions', 'sub_accounts'])
  })
})

const subs = () => [
  { id: 'egp', currency: 'EGP', balance: 1000 },
  { id: 'usd', currency: 'USD', balance: 10 },
]

describe('optimistic balances mirror the database trigger', () => {
  it('income, expense and transfer, and reverting them', () => {
    const qc = new QueryClient()
    qc.setQueryData(['sub_accounts'], subs())
    cacheApplyBalance(qc, { type: 'income', amount: 250, sub_account_id: 'egp' }, 1)
    cacheApplyBalance(qc, { type: 'expense', amount: 100, sub_account_id: 'egp' }, 1)
    cacheApplyBalance(qc, { type: 'transfer', amount: 500, sub_account_id: 'egp', to_sub_account_id: 'usd', to_amount: 10 }, 1)
    expect(qc.getQueryData<any[]>(['sub_accounts'])!.map((s) => s.balance)).toEqual([650, 20])
    // editing = revert the old version, apply the new one
    cacheApplyBalance(qc, { type: 'transfer', amount: 500, sub_account_id: 'egp', to_sub_account_id: 'usd', to_amount: 10 }, -1)
    cacheApplyBalance(qc, { type: 'transfer', amount: 520, sub_account_id: 'egp', to_sub_account_id: 'usd', to_amount: 10.4 }, 1)
    expect(qc.getQueryData<any[]>(['sub_accounts'])!.map((s) => s.balance)).toEqual([630, 20.4])
  })
})

describe('cache merging', () => {
  it('adds a transaction only to cached date ranges it belongs to, and moves it when its date changes', () => {
    const qc = new QueryClient()
    qc.setQueryData(['transactions', '2026-09-01', '2026-09-30'], [])
    qc.setQueryData(['transactions', '2026-08-01', '2026-08-31'], [])
    qc.setQueryData(['transactions', null, null], [])
    qc.setQueryData(['transactions', 'yield'], [])
    cacheUpsert(qc, 'transactions', [{ id: 't1', date: '2026-09-10', source: 'manual' }])
    expect(qc.getQueryData<any[]>(['transactions', '2026-09-01', '2026-09-30'])).toHaveLength(1)
    expect(qc.getQueryData<any[]>(['transactions', '2026-08-01', '2026-08-31'])).toHaveLength(0)
    expect(qc.getQueryData<any[]>(['transactions', null, null])).toHaveLength(1)
    expect(qc.getQueryData<any[]>(['transactions', 'yield'])).toHaveLength(0)
    // back-dated into August: leaves September, appears in August
    cacheUpsert(qc, 'transactions', [{ id: 't1', date: '2026-08-20' }])
    expect(qc.getQueryData<any[]>(['transactions', '2026-09-01', '2026-09-30'])).toHaveLength(0)
    expect(qc.getQueryData<any[]>(['transactions', '2026-08-01', '2026-08-31'])![0]).toMatchObject({ id: 't1', date: '2026-08-20', source: 'manual' })
  })
  it('leaves non-list caches (the settings object) alone', () => {
    const qc = new QueryClient()
    qc.setQueryData(['settings'], { user_id: 'me', base_currency: 'EGP' })
    expect(() => cacheUpsert(qc, 'settings', [{ id: undefined as unknown as string, user_id: 'me', base_currency: 'USD' }])).not.toThrow()
    cacheRemove(qc, 'settings', ['x'])
    expect(qc.getQueryData(['settings'])).toEqual({ user_id: 'me', base_currency: 'EGP' })
  })
  it('matches currencies by code, not by a missing id', () => {
    const qc = new QueryClient()
    qc.setQueryData(['currencies'], [{ code: 'EGP', is_active: true }, { code: 'EUR', is_active: false }])
    cacheUpsert(qc, 'currencies', [{ code: 'EUR', is_active: true } as never])
    expect(qc.getQueryData(['currencies'])).toEqual([{ code: 'EGP', is_active: true }, { code: 'EUR', is_active: true }])
  })
})
