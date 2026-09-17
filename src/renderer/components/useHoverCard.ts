import { useEffect, useRef, useState } from 'react'
import { HOVER_DELAY_MS } from './HoverCard'

/** How long leaving the row or the card waits before closing, so the gap between them can be crossed. */
const GRACE_MS = 160

/**
 * The timing behind a sidebar hover card, shared by session rows and folder rows.
 *
 * The row and the card are one hover region. The card has buttons on it, so reaching it means
 * leaving the row and crossing the gap between them — which, closed on the row's `mouseleave`
 * alone, would shut the card on the way to the very thing it exists to offer. Leaving either side
 * starts a short grace period that entering the other cancels.
 */
export function useHoverCard<T extends HTMLElement>(): {
  /** The row's rectangle while the card is up; null when it is not. */
  anchor: DOMRect | null
  ref: React.MutableRefObject<T | null>
  /** For the row's `mouseenter`. */
  arm: () => void
  /** For the card's `mouseenter`. */
  keepOpen: () => void
  /** For `mouseleave` on either. */
  scheduleClose: () => void
  /** For anything that should put the card away at once — a click, a context menu. */
  hideNow: () => void
} {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<T | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  const clearTimers = (): void => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const keepOpen = (): void => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const arm = (): void => {
    keepOpen()
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      const rect = ref.current?.getBoundingClientRect()
      if (rect !== undefined) setAnchor(rect)
    }, HOVER_DELAY_MS)
  }
  const scheduleClose = (): void => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setAnchor(null) }, GRACE_MS)
  }
  const hideNow = (): void => { clearTimers(); setAnchor(null) }

  useEffect(() => clearTimers, [])

  return { anchor, ref, arm, keepOpen, scheduleClose, hideNow }
}
