import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Where a drag started: the pointer and the committed value at that moment. */
export interface DragStart {
  x: number
  y: number
  value: number
}

export interface ResizeDragOptions {
  /** Which way the pointer moves: decides the cursor class on the body and the separator's orientation. */
  axis: 'col' | 'row'
  /** The committed value, for `aria-valuenow`. */
  value: number
  /** The floor and ceiling of `value`, for `aria-valuemin`/`-max` and the Home/End/arrow keys. */
  min: number
  max: number
  /** Read when a drag or key press begins, for a value that is not `value` itself (a box whose
   *  committed size is "fit the text" starts from what it measures now). Defaults to `value`. */
  initial?: () => number
  /** Turns a pointer position into the (already clamped) value it stands for. */
  measure: (e: { clientX: number; clientY: number }, start: DragStart) => number
  /** Called on every pointer move with the live value — write it straight to the DOM, not to state
   *  the whole app renders from. */
  onLive?: (value: number) => void
  /** Called once on release with the final value, and once per key press: undo whatever `onLive`
   *  wrote, then commit. */
  onEnd: (value: number) => void
  /** How far an arrow key moves the value; a function for a unit that depends on the size now
   *  (a fraction of the pane). Default 16. */
  step?: number | (() => number)
  /** Which arrows grow the value: `forward` is Right/Down (the default), `back` is Left/Up. */
  grows?: 'forward' | 'back'
  /** The separator's accessible name. */
  label?: string
}

/** Everything a drag handle needs to be a draggable, keyboard-operable WAI-ARIA separator. */
export interface ResizeSeparatorProps {
  role: 'separator'
  tabIndex: 0
  'aria-orientation': 'vertical' | 'horizontal'
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-valuenow': number
  'aria-label'?: string
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

const DEFAULT_STEP_PX = 16

/**
 * A drag that updates the DOM live and tells React only once, on release (UI-1 step 6 / UI-6), and
 * the keyboard alternative to it (UI-27) — the one place either is written.
 *
 * While a drag runs the body carries `resizing-active` (suppressing text selection, which the
 * repeated move-over-text of a drag is otherwise indistinguishable from) and `resizing-col`/`-row`
 * (the cursor). The listeners are on `window`, so a pointer that runs ahead of a thin handle keeps
 * dragging; a cancelled pointer ends the drag like a release. The options are read through a ref,
 * so a render mid-drag never tears the listeners down.
 *
 * `separatorProps` is the whole handle: spread it on the element. `onPointerDown` alone is
 * enough for an edge that is not a tab stop (a dialog's side).
 */
export function useResizeDrag(options: ResizeDragOptions): {
  dragging: boolean
  separatorProps: ResizeSeparatorProps
} {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(options)
  latest.current = options
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    stopRef.current?.()
    const { axis, initial, value } = latest.current
    const start: DragStart = { x: e.clientX, y: e.clientY, value: (initial ?? (() => value))() }
    const cursor = axis === 'col' ? 'resizing-col' : 'resizing-row'
    document.body.classList.add('resizing-active', cursor)
    let current = start.value
    const onMove = (ev: PointerEvent): void => {
      current = latest.current.measure(ev, start)
      latest.current.onLive?.(current)
    }
    const stop = (): void => {
      document.body.classList.remove('resizing-active', cursor)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stopRef.current = null
    }
    const onUp = (): void => {
      stop()
      setDragging(false)
      latest.current.onEnd(current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    stopRef.current = stop
    setDragging(true)
  }, [])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>): void => {
    const { axis, grows = 'forward', min, max, initial, value, step = DEFAULT_STEP_PX } = latest.current
    const forwardKey = axis === 'col' ? 'ArrowRight' : 'ArrowDown'
    const backKey = axis === 'col' ? 'ArrowLeft' : 'ArrowUp'
    const growKey = grows === 'forward' ? forwardKey : backKey
    const shrinkKey = grows === 'forward' ? backKey : forwardKey
    let next: number
    if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === growKey || e.key === shrinkKey) {
      const by = typeof step === 'function' ? step() : step
      next = (initial ?? (() => value))() + (e.key === growKey ? by : -by)
    } else return
    e.preventDefault()
    latest.current.onEnd(Math.min(max, Math.max(min, next)))
  }, [])

  const { axis, value, min, max, label } = options
  const separatorProps = useMemo<ResizeSeparatorProps>(() => ({
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': axis === 'col' ? 'vertical' : 'horizontal',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    ...(label === undefined ? {} : { 'aria-label': label }),
    onPointerDown,
    onKeyDown,
  }), [axis, value, min, max, label, onPointerDown, onKeyDown])

  return { dragging, separatorProps }
}
