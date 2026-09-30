import { useEffect, useState } from 'react'

export interface VisualViewportState {
  /** height of the visible area (shrinks when the on-screen keyboard opens) */
  height: number
  /** how far the visible area is scrolled from the layout viewport's top (iOS shifts it when the keyboard opens) */
  offsetTop: number
  keyboardOpen: boolean
}

/**
 * Tallest visible height seen at the current width. iOS keeps the layout viewport and only
 * shrinks the visual one; Android (interactive-widget=resizes-content) shrinks both. Comparing
 * against the tallest height seen at this width detects the keyboard on both platforms.
 * Reset when the width changes (rotation, window resize on desktop).
 */
const baseline = { width: 0, height: 0 }

export function readVisualViewport(): VisualViewportState {
  if (typeof window === 'undefined') return { height: 0, offsetTop: 0, keyboardOpen: false }
  const vv = window.visualViewport
  const height = vv?.height ?? window.innerHeight
  const offsetTop = vv?.offsetTop ?? 0
  if (baseline.width !== window.innerWidth) {
    baseline.width = window.innerWidth
    baseline.height = 0
  }
  baseline.height = Math.max(baseline.height, window.innerHeight, height)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return { height, offsetTop, keyboardOpen: coarse && baseline.height - height > 150 }
}

/**
 * Tracks the visual viewport so overlays can stay within the area the user can
 * actually see and touch, including while the on-screen keyboard is open.
 */
export function useVisualViewport(enabled = true): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(readVisualViewport)
  useEffect(() => {
    if (!enabled) return
    const update = () => setState(readVisualViewport())
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [enabled])
  return state
}
