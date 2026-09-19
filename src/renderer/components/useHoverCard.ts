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
  /** Shows the card at once, without the hover delay — for a click on something whose only job is to open it. */
  openNow: () => void
} {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<T | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  /**
   * Where the row was the last time we know the pointer was legitimately over it — set the moment
   * hovering starts (`arm`), not only once the card actually opens. A `mouseleave` can fire for two
   * different reasons: the pointer moved, or the row did. Sidebar sections above a row (Active,
   * most visibly — it updates live and asynchronously, on a timer unrelated to anything the pointer
   * is doing) can shift a row down while the pointer sits still, during the open delay as easily as
   * after the card is already up. The browser dispatches a real `mouseleave` either way, because
   * the row is, correctly, no longer under the pointer's viewport coordinate — but the *pointer*
   * never left anything, the floor moved. Comparing the row's current rect against this lets
   * `scheduleClose` tell the two apart instead of treating every leave as the real thing, which is
   * exactly what let `tests/e2e/sidebarBranch.spec.ts`'s hover-card test catch the Active section
   * reflowing the row out from under a still pointer — sometimes before the card even opened,
   * aborting the hover entirely with nothing left to reanchor.
   */
  const lastKnownRect = useRef<DOMRect | null>(null)

  const clearTimers = (): void => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const keepOpen = (): void => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const arm = (): void => {
    keepOpen()
    lastKnownRect.current = ref.current?.getBoundingClientRect() ?? null
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      const rect = ref.current?.getBoundingClientRect()
      if (rect !== undefined) { lastKnownRect.current = rect; setAnchor(rect) }
    }, HOVER_DELAY_MS)
  }
  const scheduleClose = (): void => {
    // Re-measure the row before trusting this leave. If it has moved since the pointer arrived —
    // whether or not the card has opened yet — the row is what moved, not the pointer: update the
    // reference to where it is now, follow an already-open card there, and leave a still-pending
    // open alone so it fires (and measures fresh) on schedule. Only a leave from a row that is
    // still exactly where the pointer found it is the real thing, and closes/cancels as before.
    const el = ref.current
    const previous = lastKnownRect.current
    if (el !== null && previous !== null) {
      const now = el.getBoundingClientRect()
      if (now.top !== previous.top || now.left !== previous.left) {
        lastKnownRect.current = now
        if (anchor !== null) setAnchor(now)
        return
      }
    }
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setAnchor(null) }, GRACE_MS)
  }
  const hideNow = (): void => { clearTimers(); lastKnownRect.current = null; setAnchor(null) }

  /**
   * Closes an open popup once the pointer is demonstrably somewhere else.
   *
   * The reflow tolerance above is a guess — it infers "the row moved, the pointer did not" from a
   * `mouseleave` plus a changed rect, and it swallows that leave. When the guess is wrong the
   * popup is orphaned: the only event that would have closed it has already been consumed, and it
   * sits on screen ignoring clicks. That is exactly what a filtered sidebar produces, where rows
   * move constantly for reasons that have nothing to do with the pointer, and it left the layout
   * picker parked in the corner of the window with no way to dismiss it.
   *
   * So the guess is no longer trusted on its own. While a popup is open this watches where the
   * pointer actually is, and starts the ordinary grace-period close as soon as it is over neither
   * the anchor nor the popup. Position is observed, not inferred, so no missed or swallowed event
   * can strand anything.
   */
  useEffect(() => {
    if (anchor === null) return
    const onMove = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (target === null) return
      // `.hover-card` covers the session card and the activity legend; `.layout-picker` the
      // layout menus. Any popup this hook drives has to be one of them, or it cannot be reached.
      if (ref.current?.contains(target) === true) return
      if (target.closest('.hover-card, .layout-picker') !== null) return
      // Already counting down — leave it alone, or a moving pointer would reset the grace period
      // forever and never actually close.
      if (closeTimer.current !== null) return
      closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setAnchor(null) }, GRACE_MS)
    }
    document.addEventListener('mousemove', onMove)
    return () => { document.removeEventListener('mousemove', onMove) }
  }, [anchor])
  const openNow = (): void => {
    clearTimers()
    const rect = ref.current?.getBoundingClientRect()
    if (rect !== undefined) { lastKnownRect.current = rect; setAnchor(rect) }
  }

  useEffect(() => clearTimers, [])

  return { anchor, ref, arm, keepOpen, scheduleClose, hideNow, openNow }
}
