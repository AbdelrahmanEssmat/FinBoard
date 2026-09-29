// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Field } from '@/components/ui/Field'

describe('Field', () => {
  it('tapping the label text does not press the first chip inside it', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <Field label="Category">
        <button type="button" onClick={first}>
          Food
        </button>
        <button type="button" onClick={second}>
          Rent
        </button>
      </Field>,
    )
    fireEvent.click(screen.getByText('Category'))
    expect(first).not.toHaveBeenCalled()
    // the chips themselves still work
    fireEvent.click(screen.getByText('Rent'))
    expect(second).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Food'))
    expect(first).toHaveBeenCalledTimes(1)
    cleanup()
  })
  it('tapping the label of a text field still focuses the field', () => {
    render(
      <Field label="Name">
        <input aria-label="name" />
      </Field>,
    )
    // jsdom does not implement label activation, so check the click is not cancelled instead
    const label = screen.getByText('Name').closest('label')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    label.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    cleanup()
  })
})
