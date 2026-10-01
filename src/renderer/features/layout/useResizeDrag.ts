import { useCallback, useEffect, useRef, useState } from 'react'

interface ResizeDragOptions {
  /** Which way the pointer moves: decides the body class that sets the resize cursor. */
  axis: 'col' | 'row'
  /** The committed value at the moment a drag starts — the drag's starting `latest`. */
  initial: () => number
  /** Turns a pointer position into the (already clamped) value it stands for. */
  measure: (e: MouseEvent) => number
  /** Called on every mousemove with the live value — write it straight to the DOM, not to state. */
  onLive: (value: number) => void
  /** Called once on mouseup with the final value: undo whatever `onLive` wrote, then commit. */
  onEnd: (value: number) => void
}

/**
 * A mouse drag that updates the DOM live and tells React only once, on release (UI-1 step 6 / UI-6).
 *
 * While it runs the body carries `resizing-active` (suppressing text selection, which the repeated
 * mousemove-over-text of a drag is otherwise indistinguishable from) and `resizing-col`/`-row`.
 * The options are read through a ref, so a render mid-drag never tears the listeners down.
 */
export function useResizeDrag(options: ResizeDragOptions): { start: () => void } {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!dragging) return
    const cursor = latest.current.axis === 'col' ? 'resizing-col' : 'resizing-row'
    document.body.classList.add('resizing-active', cursor)
    let value = latest.current.initial()
    const onMove = (e: MouseEvent): void => {
      value = latest.current.measure(e)
      latest.current.onLive(value)
    }
    const onUp = (): void => {
      setDragging(false)
      latest.current.onEnd(value)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active', cursor)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  const start = useCallback(() => { setDragging(true) }, [])
  return { start }
}
