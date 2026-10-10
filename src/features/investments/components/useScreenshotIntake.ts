import { useEffect, useRef, useState } from 'react'

/**
 * The ways a screenshot can arrive while a page is open: pasted (Ctrl/Cmd+V on a desktop), dropped
 * onto the window, or picked with the hidden file input the page renders. `dragging` is true while a
 * file hovers over the window, for a "drop it here" overlay.
 */
export function useScreenshotIntake(onFile: (file: File) => void, enabled = true) {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(onFile)
  useEffect(() => {
    latest.current = onFile
  }, [onFile])
  // nested elements fire enter/leave in pairs; count them so the overlay doesn't flicker
  const depth = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file) return
      e.preventDefault()
      latest.current(file)
    }
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth.current++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
    }
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      depth.current = 0
      setDragging(false)
      if (!isFileDrag(e)) return
      e.preventDefault()
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (file) latest.current(file)
    }
    document.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      depth.current = 0
      setDragging(false)
    }
  }, [enabled])

  return { dragging }
}
