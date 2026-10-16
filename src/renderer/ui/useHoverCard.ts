import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HOVER_DELAY_MS } from './HoverCard'

/** How long leaving the row or the card waits before closing, so the gap between them can be crossed. */
const GRACE_MS = 160

/**
 * The delay once a card is already showing, or has only just gone: scanning down the list should
 * not flicker blank gaps. Kept above the time to cross one row diagonally, so a pointer heading
 * from a row to its card does not open the card of a row it clips.
 */
const WARM_DELAY_MS = 120
/** How long after a card closes the next one still counts as a continuation of the same scan. */
const WARM_WINDOW_MS = 400

/**
 * The one card that may be open, as a way to close it.
 *
 * Module-level because no single hook can know what the others are doing. Opening a card closes
 * whatever else is open, so cards cannot stack whatever the timers do.
 */
let openCard: { current: () => void; row: () => HTMLElement | null } | null = null

/**
 * Whether a modal dialog is open. A hover card never opens over one: the card is portalled to the
 * page body, a modal lives inside its pane's stacking context, so the card drew on top of the
 * dialog the row's own button had just opened.
 */
function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null
}

/** Closes whichever hover card is open; `Modal` calls it as it opens. */
export function closeOpenHoverCard(): void {
  openCard?.current()
}
let lastCardClosedAtMs = 0
function isWarm(): boolean {
  return openCard !== null || Date.now() - lastCardClosedAtMs < WARM_WINDOW_MS
}

/**
 * How long after a scroll a hover is still treated as the scroll's doing rather than the pointer's.
 *
 * Scrolling drags rows underneath a pointer that has not moved. Each gets a real `mouseenter`,
 * and has moved by its `mouseleave`, which `scheduleClose` reads as "the row moved, not the
 * pointer" and swallows. Long enough to cover the gap between wheel events in one gesture; short
 * enough that resting after a scroll still shows a card.
 */
const SCROLL_QUIET_MS = 250

/**
 * When anything in the window last scrolled.
 *
 * Shared by every hook instance: the row that must not open a card is rarely the element that
 * scrolled. One capture-phase listener sees every scroll in the window.
 */
let lastScrollAtMs = 0
/**
 * The instances currently mid-open-delay (armed by a `mouseenter`, not yet showing a card). Only
 * these are cancelled on scroll, so a wheel notch costs O(armed), not O(rows).
 */
const armedInstances = new Set<() => void>()
/** The event a settled scroll dispatches at the element under the pointer — see `scheduleReopenCheck`. */
const HOVER_SETTLE_EVENT = 'apiary:hover-settle'
let reopenCheckTimer: number | null = null
/**
 * After a scroll goes quiet, asks the DOM once which element is under the pointer and lets *that*
 * element's own listener (added by whichever `useHoverCard` instance owns it, if any) decide
 * whether to reopen — bubbling finds the right row in O(depth), not O(rows).
 */
function scheduleReopenCheck(): void {
  if (reopenCheckTimer !== null) window.clearTimeout(reopenCheckTimer)
  reopenCheckTimer = window.setTimeout(() => {
    reopenCheckTimer = null
    if (scrolledJustNow() || typeof document === 'undefined') return
    const el = document.elementFromPoint(pointer.x, pointer.y)
    el?.dispatchEvent(new CustomEvent(HOVER_SETTLE_EVENT, { bubbles: true }))
  }, SCROLL_QUIET_MS + HOVER_DELAY_MS)
}
/**
 * Where the pointer is, tracked globally.
 *
 * A scroll has to ask "is the pointer still over this row?" after it settles, and `mouseenter` /
 * `mouseleave` do not fire when the pointer stays within one row.
 */
const pointer = { x: -1, y: -1 }
/**
 * What the pointer was last over, or null once it has left the window.
 *
 * A scroll only matters to hover cards when it moves things under the pointer or moves the row a
 * card is showing. Without this, a scroll elsewhere would open the card of whatever sat under the
 * pointer's *last* position, even with the pointer long gone to another window.
 */
let pointerOver: Element | null = null
/**
 * Where the last click landed, until the pointer moves away from it.
 *
 * A click on a session row opens the session, which moves every row below under a pointer that has
 * not moved. The browser counts the row now under it as entered, and its card came up over the
 * pane the person was reaching for. A card is armed only by a pointer that has moved since its click.
 */
let clickedAt: { x: number; y: number } | null = null
/** How far the pointer must move after a click before hovering counts again: a hand's tremor less. */
const CLICK_STILL_PX = 4
function stillSinceClick(): boolean {
  return clickedAt !== null
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    clickedAt = { x: e.clientX, y: e.clientY }
  }, { capture: true, passive: true })
  document.addEventListener('scroll', (e) => {
    const scroller = e.target instanceof Element ? e.target : document.documentElement
    const row = openCard?.row() ?? null
    if (openCard !== null && (row === null || scroller.contains(row))) openCard.current()
    if (pointerOver === null || !scroller.contains(pointerOver)) return
    lastScrollAtMs = Date.now()
    for (const cancelArm of armedInstances) cancelArm()
    armedInstances.clear()
    scheduleReopenCheck()
  }, { capture: true, passive: true })
  document.addEventListener('mousemove', (e) => {
    if (clickedAt !== null && Math.hypot(e.clientX - clickedAt.x, e.clientY - clickedAt.y) > CLICK_STILL_PX) clickedAt = null
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointerOver = e.target instanceof Element ? e.target : document.documentElement
  }, { capture: true, passive: true })
  // Out of the window: there is nothing under the pointer here any more, so nothing to reopen,
  // and no `mousemove` will arrive to close a card left up (see the watcher in useHoverCard).
  document.documentElement.addEventListener('mouseleave', () => {
    pointer.x = -1
    pointer.y = -1
    pointerOver = null
    if (reopenCheckTimer !== null) { window.clearTimeout(reopenCheckTimer); reopenCheckTimer = null }
    openCard?.current()
  })
}
function scrolledJustNow(): boolean {
  return Date.now() - lastScrollAtMs < SCROLL_QUIET_MS
}

/** What `getBoundingClientRect` returns for a hidden or detached node; anchoring to it puts the popup in the window's corner. */
function isDegenerate(rect: DOMRect): boolean {
  return rect.width === 0 && rect.height === 0
}

export interface HoverCardOptions {
  /**
   * A selector for an ancestor of the anchor that also counts as "still here" while the popup is
   * open. The layout picker passes its session row: the pointer on its way to the picker crosses
   * the row's other buttons, which are neither the button nor the picker.
   */
  safeWithin?: string
}

/**
 * The timing behind a sidebar hover card, shared by session rows and folder rows.
 *
 * The row and the card are one hover region. The card has buttons on it, so reaching it means
 * leaving the row and crossing the gap between them — which, closed on the row's `mouseleave`
 * alone, would shut the card on the way to the very thing it exists to offer. Leaving either side
 * starts a short grace period that entering the other cancels.
 */
export function useHoverCard<T extends HTMLElement>(options: HoverCardOptions = {}): {
  /** The row's rectangle while the card is up; null when it is not. */
  anchor: DOMRect | null
  ref: React.RefObject<T | null>
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
   * Where the row was when hovering started (`arm`), not only once the card opens. A `mouseleave`
   * fires when the pointer moved or when the row did (the Active section updates live and can
   * shift a row under a still pointer). Comparing the row's current rect against this lets
   * `scheduleClose` tell the two apart.
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
    // A `mouseenter` that arrived because the list scrolled, not because the pointer went
    // anywhere. Opening on it is what produced a trail of cards down the sidebar.
    if (scrolledJustNow()) return
    lastKnownRect.current = ref.current?.getBoundingClientRect() ?? null
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    const cancelArm = (): void => {
      if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
      armedInstances.delete(cancelArm)
    }
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      armedInstances.delete(cancelArm)
      // Checked when the card would open, not only at arm time: the wheel may have turned during
      // the delay, and the browser sends the enter before the move, so a real move away from a
      // click has not been seen yet at arm time.
      if (scrolledJustNow() || modalOpen() || stillSinceClick()) return
      const rect = ref.current?.getBoundingClientRect()
      if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
    }, isWarm() ? WARM_DELAY_MS : HOVER_DELAY_MS)
    armedInstances.add(cancelArm)
  }
  const scheduleClose = (): void => {
    // A row that moved since the pointer arrived is what moved, not the pointer: follow an
    // already-open card there and leave a pending open alone. Only a leave from a row still
    // where the pointer found it is real.
    const el = ref.current
    const previous = lastKnownRect.current
    // Never during a scroll. The tolerance exists for a row displaced by something the pointer had
    // nothing to do with — a live section resizing above it — and a scroll moves every row at
    // once, so applying it here swallows every genuine leave the scroll produces.
    if (el !== null && previous !== null && !scrolledJustNow()) {
      const now = el.getBoundingClientRect()
      if (!isDegenerate(now) && (now.top !== previous.top || now.left !== previous.left)) {
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
   * The reflow tolerance above is a guess ("the row moved, the pointer did not") that swallows the
   * leave; when wrong, the popup is orphaned with nothing left to close it (a filtered sidebar moves
   * rows constantly). So while a popup is open this observes where the pointer is, and starts the
   * grace-period close once it is over neither the anchor nor the popup.
   */
  useEffect(() => {
    if (anchor === null) return
    const onMove = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (target === null) return
      // `.hover-card` covers the session card and the activity legend; `.layout-picker` the
      // layout menus. Any popup this hook drives has to be one of them, or it cannot be reached.
      const safe = options.safeWithin === undefined ? null : ref.current?.closest(options.safeWithin) ?? null
      if (
        ref.current?.contains(target) === true
        || target.closest('.hover-card, .layout-picker') !== null
        || safe?.contains(target) === true
      ) {
        if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
        return
      }
      // Already counting down — leave it alone, or a moving pointer would reset the grace period
      // forever and never actually close.
      if (closeTimer.current !== null) return
      closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setAnchor(null) }, GRACE_MS)
    }
    document.addEventListener('mousemove', onMove)
    return () => { document.removeEventListener('mousemove', onMove) }
  }, [anchor, options.safeWithin])
  /**
   * A scroll puts the popup away (the document-level listener closes `openCard`), and it comes back
   * once the list stops moving if the pointer rests on this row. Only instances whose `ref` is the
   * element under the pointer, or an ancestor of it, receive `HOVER_SETTLE_EVENT` (by bubbling).
   */
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onSettle = (): void => {
      if (scrolledJustNow() || modalOpen()) return
      const rect = el.getBoundingClientRect()
      if (!isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
    }
    el.addEventListener(HOVER_SETTLE_EVENT, onSettle)
    return () => { el.removeEventListener(HOVER_SETTLE_EVENT, onSettle) }
  }, [])

  const openNow = (): void => {
    clearTimers()
    if (modalOpen()) return
    const rect = ref.current?.getBoundingClientRect()
    if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
  }

  /**
   * Enforces the one-card rule: this card opening closes any other, and its closing is recorded
   * for the warm delay. A layout effect, so the card being replaced is gone before the browser
   * paints the new one — never a frame with both.
   */
  const closeSelf = useRef({
    current: (): void => {
      if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
      if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
      lastKnownRect.current = null
      setAnchor(null)
    },
    row: (): HTMLElement | null => ref.current,
  })
  useLayoutEffect(() => {
    if (anchor === null) {
      if (openCard === closeSelf.current) { openCard = null; lastCardClosedAtMs = Date.now() }
      return
    }
    if (openCard !== null && openCard !== closeSelf.current) openCard.current()
    openCard = closeSelf.current
  }, [anchor])
  useEffect(() => () => {
    clearTimers()
    if (openCard === closeSelf.current) { openCard = null; lastCardClosedAtMs = Date.now() }
  }, [])

  return { anchor, ref, arm, keepOpen, scheduleClose, hideNow, openNow }
}
