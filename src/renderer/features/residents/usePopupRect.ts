import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { readResidentPopupRect, type ResidentPopupRect, writeResidentPopupRect } from '../../state/uiState'
import { type DragStart, useResizeDrag } from '../../ui/useResizeDrag'

const DEFAULT_SIZE = { width: 380, height: 480 }
const MIN = { width: 320, height: 280 }
const MAX_VIEW_SHARE = { width: 0.92, height: 0.85 }
const RIGHT_GAP = 12
const BAR_GAP = 6

/** The window, and how much of its bottom the status bar holds (with a gap): the popup stays above it. */
interface View { width: number; height: number; floor: number }

/** The rect squeezed into the window above the status bar: within its min and max size, wholly on screen. */
function clampRect(rect: ResidentPopupRect, view: View): ResidentPopupRect {
  const room = view.height - view.floor
  const width = Math.max(MIN.width, Math.min(rect.width, view.width * MAX_VIEW_SHARE.width))
  const height = Math.max(Math.min(MIN.height, room), Math.min(rect.height, view.height * MAX_VIEW_SHARE.height, room))
  return {
    width,
    height,
    right: Math.max(0, Math.min(rect.right, view.width - width)),
    bottom: Math.max(view.floor, Math.min(rect.bottom, view.height - height)),
  }
}

const statusBar = (): Element | null => document.querySelector('.status-bar')

function viewport(): View {
  const bar = statusBar()
  const floor = bar === null ? 0 : Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) + BAR_GAP
  return { width: window.innerWidth, height: window.innerHeight, floor }
}

/** Bottom-right, just above the status bar. */
function defaultRect(): ResidentPopupRect {
  return { ...DEFAULT_SIZE, right: RIGHT_GAP, bottom: viewport().floor }
}

type Handle = 'move' | 'left' | 'top' | 'corner'

/** The rect a drag of `handle` by (dx, dy) from `from` makes; the panel is anchored bottom-right. */
function dragged(handle: Handle, from: ResidentPopupRect, dx: number, dy: number): ResidentPopupRect {
  switch (handle) {
    case 'move': return { ...from, right: from.right - dx, bottom: from.bottom - dy }
    case 'left': return { ...from, width: from.width - dx }
    case 'top': return { ...from, height: from.height - dy }
    case 'corner': return { ...from, width: from.width - dx, height: from.height - dy }
  }
}

function applyRect(el: HTMLElement | null, rect: ResidentPopupRect): void {
  if (el === null) return
  el.style.right = `${String(rect.right)}px`
  el.style.bottom = `${String(rect.bottom)}px`
  el.style.width = `${String(rect.width)}px`
  el.style.height = `${String(rect.height)}px`
}

/**
 * The popup's rectangle: the one this window saved, or bottom-right above the status bar, clamped
 * into the window on open and on every resize. A drag writes the DOM live and saves on release.
 */
export function usePopupRect(panel: RefObject<HTMLElement | null>): {
  rect: ResidentPopupRect
  handle: (which: Handle) => (e: ReactPointerEvent<HTMLElement>) => void
} {
  const [rect, setRect] = useState(() => clampRect(readResidentPopupRect() ?? defaultRect(), viewport()))
  // Clamped again when the window or the status bar changes size: a taller bar, chosen or grown for
  // a working resident, pushes the popup up rather than sliding under it.
  useEffect(() => {
    const onResize = (): void => { setRect((cur) => clampRect(cur, viewport())) }
    window.addEventListener('resize', onResize)
    const bar = statusBar()
    const observer = new ResizeObserver(onResize)
    if (bar !== null) observer.observe(bar)
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [])

  const latest = useRef(rect)
  latest.current = rect
  const live = useRef<ResidentPopupRect | null>(null)
  const commit = (): void => {
    const next = live.current
    live.current = null
    if (next === null) return
    setRect(next)
    writeResidentPopupRect(next)
  }
  const drag = { panel, latest, live, commit }
  const handles: Record<Handle, PointerDown> = {
    move: useHandleDrag('move', drag),
    left: useHandleDrag('left', drag),
    top: useHandleDrag('top', drag),
    corner: useHandleDrag('corner', drag),
  }
  return { rect, handle: (which) => handles[which] }
}

type PointerDown = (e: ReactPointerEvent<HTMLElement>) => void

/** One handle's drag: the rect it makes, clamped, written to the panel live; committed on release. */
function useHandleDrag(which: Handle, drag: {
  panel: RefObject<HTMLElement | null>
  latest: RefObject<ResidentPopupRect>
  live: RefObject<ResidentPopupRect | null>
  commit: () => void
}): PointerDown {
  return useResizeDrag({
    axis: which === 'top' ? 'row' : 'col',
    // A pointer drag of a rectangle, not a value on one axis: the rect travels through `live`.
    value: 0,
    min: 0,
    max: 0,
    measure: (e: { clientX: number; clientY: number }, start: DragStart) => {
      drag.live.current = clampRect(dragged(which, drag.latest.current, e.clientX - start.x, e.clientY - start.y), viewport())
      applyRect(drag.panel.current, drag.live.current)
      return 0
    },
    onEnd: drag.commit,
  }).separatorProps.onPointerDown
}
