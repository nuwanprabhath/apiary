import { useRef } from 'react'
import { useResizeDrag } from '../ui/useResizeDrag'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 600

// Floor keeps the toolbar plus a few rows of terminal usable; ceiling leaves the transcript
// area above it readable rather than squeezed to a sliver.
const MIN_BOTTOM_HEIGHT = 120
const MAX_BOTTOM_HEIGHT = 560

/**
 * The sidebar's and the bottom shell pane's resize drags. `useResizeDrag` owns the
 * `resizing-active` body class and the listeners.
 *
 * The live value goes straight onto an element's style as a CSS custom property, which the
 * layout reads with the committed width as its fallback; React only hears about the final width,
 * once, on `mouseup`, and it is persisted like any other ui change.
 */
export function useWindowResizers(
  sidebarWidth: number,
  bottomHeight: number,
  setSidebarWidth: (w: number) => void,
  setBottomHeight: (h: number) => void,
) {
  /** The `.layout` grid element — the sidebar drag writes the live width to its style. */
  const layoutRef = useRef<HTMLDivElement | null>(null)

  const sidebarResize = useResizeDrag({
    axis: 'col',
    value: sidebarWidth,
    min: MIN_SIDEBAR_WIDTH,
    max: MAX_SIDEBAR_WIDTH,
    label: 'Resize the sidebar',
    measure: (e) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX)),
    onLive: (w) => { layoutRef.current?.style.setProperty('--drag-sidebar-width', `${String(w)}px`) },
    onEnd: (w) => {
      layoutRef.current?.style.removeProperty('--drag-sidebar-width')
      setSidebarWidth(w)
    },
  })

  // Height is measured from the cursor to the bottom of the window. Set on the root, not
  // `layoutRef`: every open `SessionColumn`'s shell pane reads this, and panes are siblings.
  const bottomResize = useResizeDrag({
    axis: 'row',
    value: bottomHeight,
    min: MIN_BOTTOM_HEIGHT,
    max: MAX_BOTTOM_HEIGHT,
    label: 'Resize the terminal pane',
    // Dragging up (a smaller clientY) grows the pane, so ArrowUp is the "bigger" key too.
    grows: 'back',
    measure: (e) => Math.min(MAX_BOTTOM_HEIGHT, Math.max(MIN_BOTTOM_HEIGHT, window.innerHeight - e.clientY)),
    onLive: (h) => { document.documentElement.style.setProperty('--drag-bottom-height', `${String(h)}px`) },
    onEnd: (h) => {
      document.documentElement.style.removeProperty('--drag-bottom-height')
      setBottomHeight(h)
    },
  })

  return { layoutRef, sidebarResize, bottomResize }
}
