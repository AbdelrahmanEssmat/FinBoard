// @vitest-environment jsdom
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useDialogFocus } from '@/hooks/useDialogFocus'

function Dialog({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, open)
  if (!open) return null
  return (
    <div ref={ref} tabIndex={-1} data-testid="panel">
      <button>first</button>
      <button>last</button>
    </div>
  )
}

describe('useDialogFocus', () => {
  it('moves focus in, keeps Tab inside, and hands focus back on close', () => {
    const { rerender } = render(
      <>
        <button>opener</button>
        <Dialog open={false} />
      </>,
    )
    const opener = screen.getByText('opener')
    opener.focus()
    rerender(
      <>
        <button>opener</button>
        <Dialog open />
      </>,
    )
    expect(document.activeElement).toBe(screen.getByTestId('panel'))

    // Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last
    screen.getByText('last').focus()
    fireEvent.keyDown(screen.getByTestId('panel'), { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
    fireEvent.keyDown(screen.getByTestId('panel'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('last'))

    act(() => {
      rerender(
        <>
          <button>opener</button>
          <Dialog open={false} />
        </>,
      )
    })
    expect(document.activeElement).toBe(opener)
    cleanup()
  })
})
