// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScanPricesSheet } from '@/features/investments/components/ScanPricesSheet'
import { d } from '@/domain/money'
import type { ScanResult } from '@/domain/priceScan'
import type { Holding } from '@/api/database.types'

// the sheet and amounts measure themselves; jsdom has no ResizeObserver
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver

const holding = (id: string, name: string, ticker: string | null, units: number, price: number): Holding =>
  ({ id, user_id: 'u', account_id: 'a', category_id: null, name, ticker, units, avg_cost: price, current_price: price, currency: 'EGP', price_updated_at: null, bought_at: null, closed_at: null, notes: null, created_at: '', updated_at: '' }) as Holding

const holdings = [holding('etel', 'Telecom Egypt', 'ETEL', 400, 36), holding('abuk', 'Abu Qir', 'ABUK', 50, 230), holding('cib', 'CIB', 'COMI', 10, 80)]

const row = (label: string, raw: string, value: number, y: number) => ({ label, raw, value: d(value), alts: [], y, ocr: 90 })
const result: ScanResult = {
  matches: [
    { ...row('ETEL', '14,800', 14800, 1), holdingId: 'etel', kind: 'total', price: d(37), ambiguous: false, confidence: 'high', reason: 'Ticker matched' },
    { ...row('ABUK', '30,000', 30000, 2), holdingId: 'abuk', kind: 'total', price: d(600), ambiguous: true, confidence: 'low', reason: 'Doesn’t look like the last price (230.00)' },
  ],
  unmatched: [row('CMS', '29,943', 29943, 3)],
  notFound: ['cib'],
}

function mount(onApply = vi.fn()) {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  render(<ScanPricesSheet file={null} holdings={holdings} onClose={() => {}} onApply={onApply} onPickAnother={() => {}} initialResult={result} />, { wrapper })
  return onApply
}

describe('checking what a scan read', () => {
  it('ticks the sure rows, leaves the doubtful one unticked, and offers per unit / total only where it is unclear', () => {
    mount()
    expect(screen.getByRole('dialog')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Price per unit', 'Total value'])
    expect(screen.getByRole('button', { name: 'Apply 1 price' })).toBeTruthy()
    expect(screen.getByText(/Not in the screenshot: COMI/)).toBeTruthy()
    cleanup()
  })
  it('applies the ticked prices per unit, including a fixed one and one picked by hand', () => {
    const onApply = mount()
    fireEvent.change(screen.getByLabelText('New price for Telecom Egypt'), { target: { value: '37.5' } })
    fireEvent.change(screen.getByLabelText('Holding for CMS'), { target: { value: 'cib' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 prices' }))
    expect(onApply).toHaveBeenCalledWith({ etel: '37.5', cib: '2994.3' })
    cleanup()
  })
  it('a bad number blocks Apply until it is fixed or unticked', () => {
    mount()
    fireEvent.change(screen.getByLabelText('New price for Telecom Egypt'), { target: { value: '3x' } })
    expect((screen.getByRole('button', { name: 'Fix the number first' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getByRole('button', { name: 'Nothing ticked' })).toBeTruthy()
    cleanup()
  })
})
