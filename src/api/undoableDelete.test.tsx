// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/supabase', () => ({ supabase: {}, isNetworkError: () => false }))
const submit = vi.fn(async () => ({ queued: false }))
vi.mock('@/offline/mutate', () => ({ submit: (...args: unknown[]) => submit(...(args as [])) }))

import { useUndoableDelete } from '@/api/mutations'
import { useToasts } from '@/store/toasts'

function setup() {
  const qc = new QueryClient()
  qc.setQueryData(['accounts'], [{ id: 'a1' }, { id: 'a2' }])
  qc.setQueryData(['sub_accounts'], [
    { id: 's1', account_id: 'a1', balance: 100 },
    { id: 's2', account_id: 'a2', balance: 50 },
  ])
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useUndoableDelete('accounts', { label: 'Account' }), { wrapper })
  return { qc, del: result.current }
}
const ids = (qc: QueryClient, table: string) => (qc.getQueryData<{ id: string }[]>([table]) ?? []).map((r) => r.id)
const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  vi.useRealTimers()
  submit.mockClear()
  useToasts.setState({ toasts: [] })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('deleting with undo', () => {
  it("a deleted account's balances leave the totals at once, and come back on undo", () => {
    vi.useFakeTimers()
    const { qc, del } = setup()
    act(() => del({ id: 'a1' } as never))
    expect(ids(qc, 'accounts')).toEqual(['a2'])
    expect(ids(qc, 'sub_accounts')).toEqual(['s2'])
    act(() => useToasts.getState().toasts[0]!.undo!())
    expect(ids(qc, 'accounts').sort()).toEqual(['a1', 'a2'])
    expect(ids(qc, 'sub_accounts').sort()).toEqual(['s1', 's2'])
    vi.advanceTimersByTime(7000)
    expect(submit).not.toHaveBeenCalled()
  })

  it('is sent when the undo window ends', async () => {
    vi.useFakeTimers()
    const { del } = setup()
    act(() => del({ id: 'a1' } as never))
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({ kind: 'delete', table: 'accounts', ids: ['a1'] })
  })

  it('is sent at once, and only once, when the app is hidden or closed during the window', async () => {
    vi.useFakeTimers()
    const { del } = setup()
    act(() => del({ id: 'a1' } as never))
    await act(async () => hide())
    expect(submit).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      vi.advanceTimersByTime(7000)
    })
    expect(submit).toHaveBeenCalledTimes(1)
    // and Undo can no longer bring it back once it has been sent
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})
