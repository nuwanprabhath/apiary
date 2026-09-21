import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HOVER_DELAY_MS } from './HoverCard'

/** How long leaving the row or the card waits before closing, so the gap between them can be crossed. */
const GRACE_MS = 160

/**
 * The delay once a card is already showing, or has only just gone.
 *
 * The first card waits `HOVER_DELAY_MS`, so a pointer passing through the sidebar on its way
 * somewhere else does not set cards off. But someone running down the list reading each session
 * has already said what they want: making them wait the full delay on every row turns the scan
 * into a flicker of blank gaps. Kept above the time it takes to cross one row diagonally, so a
 * pointer on its way from a row to its card does not open the card of a row it clips on the way.
 */
const WARM_DELAY_MS = 120
/** How long after a card closes the next one still counts as a continuation of the same scan. */
const WARM_WINDOW_MS = 400

/**
 * The one card that may be open, as a way to close it.
 *
 * Module-level because only one popup should ever be on screen, and no single hook can know what
 * the others are doing. Each card previously closed itself on its own schedule, and any path that
 * swallowed its close left it up beside the next one — the stacks of cards that kept being
 * reported. With this, opening a card closes whatever else is open, so stacking cannot happen
 * whatever the timers do.
 */
let openCard: { current: () => void } | null = null
let lastCardClosedAtMs = 0
function isWarm(): boolean {
  return openCard !== null || Date.now() - lastCardClosedAtMs < WARM_WINDOW_MS
}

/**
 * How long after a scroll a hover is still treated as the scroll's doing rather than the pointer's.
 *
 * Scrolling drags rows underneath a pointer that has not moved. Every row that passes under it
 * gets a real `mouseenter`, and every one of those rows has also moved by the time its
 * `mouseleave` arrives — which is the exact condition `scheduleClose` reads as "the row moved, not
 * the pointer" and swallows. So each row armed a card and none of them could close it, and a
 * flick of the wheel left a stack of cards over the sidebar. Long enough to cover the gap between
 * wheel events in one gesture; short enough that resting after a scroll still shows a card.
 */
const SCROLL_QUIET_MS = 250

/**
 * When anything in the window last scrolled.
 *
 * Module-level and shared by every hook instance on purpose: the row that must not open a card is
 * rarely the element that scrolled, so each hook asking only about its own subtree would miss it.
 * One capture-phase listener sees every scroll in the window, including inside the sidebar.
 */
let lastScrollAtMs = 0
const scrollListeners = new Set<() => void>()
/**
 * Where the pointer is, tracked globally.
 *
 * Needed because a scroll has to be able to ask "is the pointer still over this row?" after it
 * settles. The events that would otherwise answer that — `mouseenter` and `mouseleave` — do not
 * fire when the pointer stays within one row, so a card put away by a scroll could never come
 * back while the pointer rested exactly where the user left it.
 */
const pointer = { x: -1, y: -1 }
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', () => {
    lastScrollAtMs = Date.now()
    for (const notify of scrollListeners) notify()
  }, { capture: true, passive: true })
  document.addEventListener('mousemove', (e) => {
    pointer.x = e.clientX
    pointer.y = e.clientY
  }, { capture: true, passive: true })
}
function pointerIsOver(el: Element | null): boolean {
  if (el === null || pointer.x < 0) return false
  const r = el.getBoundingClientRect()
  if (isDegenerate(r)) return false
  return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom
}
function scrolledJustNow(): boolean {
  return Date.now() - lastScrollAtMs < SCROLL_QUIET_MS
}

/** A rect an element cannot actually be occupying — what `getBoundingClientRect` returns for a
 *  hidden or detached node. Anchoring to one puts the popup in the window's corner, nowhere near
 *  whatever opened it, and leaves it there. */
function isDegenerate(rect: DOMRect): boolean {
  return rect.width === 0 && rect.height === 0
}

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
    // A `mouseenter` that arrived because the list scrolled, not because the pointer went
    // anywhere. Opening on it is what produced a trail of cards down the sidebar.
    if (scrolledJustNow()) return
    lastKnownRect.current = ref.current?.getBoundingClientRect() ?? null
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      // Re-checked here as well as on entry: the wheel may have turned during the delay, and the
      // row under the pointer now is not the row the pointer chose.
      if (scrolledJustNow()) return
      const rect = ref.current?.getBoundingClientRect()
      if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
    }, isWarm() ? WARM_DELAY_MS : HOVER_DELAY_MS)
  }
  const scheduleClose = (): void => {
    // Re-measure the row before trusting this leave. If it has moved since the pointer arrived —
    // whether or not the card has opened yet — the row is what moved, not the pointer: update the
    // reference to where it is now, follow an already-open card there, and leave a still-pending
    // open alone so it fires (and measures fresh) on schedule. Only a leave from a row that is
    // still exactly where the pointer found it is the real thing, and closes/cancels as before.
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
  /**
   * A scroll puts every popup away at once.
   *
   * Not a grace period: the row a card describes is no longer where the card is pointing the
   * moment the list moves, so there is nothing to preserve by waiting. Closing here also covers
   * the card that was legitimately open *before* the scroll began, which the suppression in `arm`
   * cannot reach.
   */
  useEffect(() => {
    const onScroll = (): void => {
      if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
      if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
      setAnchor(null)
      // ...and come back once the list has stopped moving, if the pointer turns out to be resting
      // on this row. Each scroll event replaces this timer, so a long scroll settles once at the
      // end rather than flickering a card between wheel notches — the debounce this needed.
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null
        if (scrolledJustNow() || !pointerIsOver(ref.current)) return
        const rect = ref.current?.getBoundingClientRect()
        if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
      }, SCROLL_QUIET_MS + HOVER_DELAY_MS)
    }
    scrollListeners.add(onScroll)
    return () => { scrollListeners.delete(onScroll) }
  }, [])

  const openNow = (): void => {
    clearTimers()
    const rect = ref.current?.getBoundingClientRect()
    if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
  }

  /**
   * Enforces the one-card rule: this card opening closes any other, and its closing is recorded
   * for the warm delay. A layout effect, so the card being replaced is gone before the browser
   * paints the new one — never a frame with both.
   */
  const closeSelf = useRef(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    lastKnownRect.current = null
    setAnchor(null)
  })
  useLayoutEffect(() => {
    if (anchor === null) {
      if (openCard === closeSelf) { openCard = null; lastCardClosedAtMs = Date.now() }
      return
    }
    if (openCard !== null && openCard !== closeSelf) openCard.current()
    openCard = closeSelf
  }, [anchor])
  useEffect(() => () => {
    clearTimers()
    if (openCard === closeSelf) { openCard = null; lastCardClosedAtMs = Date.now() }
  }, [])

  return { anchor, ref, arm, keepOpen, scheduleClose, hideNow, openNow }
}
