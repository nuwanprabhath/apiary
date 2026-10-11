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
let openCard: { current: () => void; row: () => HTMLElement | null } | null = null

/**
 * Whether a modal dialog is open. A hover card never opens over one: the card is portalled to the
 * page body, a modal lives inside its pane's stacking context, so the card drew on top of the
 * dialog the row's own button had just opened (found in the folder browser's screenshots).
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
/**
 * The instances currently mid-open-delay (armed by a `mouseenter`, not yet showing a card).
 *
 * UI-7: this used to be every mounted hook — a scroll queued a settle-check timer for all of them
 * and re-measured each one's `getBoundingClientRect()` once it fired, which is O(rows) timers and
 * layout reads per wheel notch on a large sidebar. In practice at most a couple of instances are
 * ever mid-delay at once (a row and the split button inside it), so cancelling just these on scroll
 * is O(armed) instead — everything else has no timer to cancel in the first place.
 */
const armedInstances = new Set<() => void>()
/** The event a settled scroll dispatches at the element under the pointer — see `scheduleReopenCheck`. */
const HOVER_SETTLE_EVENT = 'apiary:hover-settle'
let reopenCheckTimer: number | null = null
/**
 * After a scroll goes quiet, asks the DOM once which element is under the pointer and lets *that*
 * element's own listener (added by whichever `useHoverCard` instance owns it, if any) decide
 * whether to reopen — native event bubbling finds the right row in O(depth), not O(rows). This
 * replaces every mounted instance scheduling its own settle timer and reading its own
 * `getBoundingClientRect()` to ask "is the pointer over *me*?" — one question this answers once for
 * everybody instead of asking N times.
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
 * Needed because a scroll has to be able to ask "is the pointer still over this row?" after it
 * settles. The events that would otherwise answer that — `mouseenter` and `mouseleave` — do not
 * fire when the pointer stays within one row, so a card put away by a scroll could never come
 * back while the pointer rested exactly where the user left it.
 */
const pointer = { x: -1, y: -1 }
/**
 * What the pointer was last over, or null once it has left the window.
 *
 * A scroll only matters to hover cards when it moves things under the pointer or moves the row a
 * card is showing. Every other scroll — a transcript following Claude's reply, a terminal
 * scrolling its output — used to close the card being read, and then, once quiet, open the card
 * of whatever row sat under the pointer's *last* position. With the pointer long gone to another
 * window, that put a card up beside the sidebar with no mouse anywhere near it.
 */
let pointerOver: Element | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', (e) => {
    const scroller = e.target instanceof Element ? e.target : document.documentElement
    // The row a card describes is no longer where the card is pointing the moment its list
    // moves — close the one card that can be open (the one-card rule) rather than every mounted
    // instance asking whether it happens to be the one.
    const row = openCard?.row() ?? null
    if (openCard !== null && (row === null || scroller.contains(row))) openCard.current()
    if (pointerOver === null || !scroller.contains(pointerOver)) return
    lastScrollAtMs = Date.now()
    for (const cancelArm of armedInstances) cancelArm()
    armedInstances.clear()
    scheduleReopenCheck()
  }, { capture: true, passive: true })
  document.addEventListener('mousemove', (e) => {
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

/** A rect an element cannot actually be occupying — what `getBoundingClientRect` returns for a
 *  hidden or detached node. Anchoring to one puts the popup in the window's corner, nowhere near
 *  whatever opened it, and leaves it there. */
function isDegenerate(rect: DOMRect): boolean {
  return rect.width === 0 && rect.height === 0
}

export interface HoverCardOptions {
  /**
   * A selector for an ancestor of the anchor that also counts as "still here" while the popup is
   * open. The layout picker passes its session row: the picker opens beside its button, and the
   * pointer on its way there crosses the row's other buttons — the Recent row's dismiss button most
   * of all — which are neither the button nor the picker, so the grace period ran out mid-crossing
   * and the picker vanished unless the pointer was moved very fast.
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
    // Registered so a scroll starting during the delay can cancel just this timer (UI-7) instead
    // of every mounted instance being asked to check and clear one it never had.
    const cancelArm = (): void => {
      if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
      armedInstances.delete(cancelArm)
    }
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      armedInstances.delete(cancelArm)
      // Re-checked here as well as on entry: the wheel may have turned during the delay, and the
      // row under the pointer now is not the row the pointer chose.
      if (scrolledJustNow() || modalOpen()) return
      const rect = ref.current?.getBoundingClientRect()
      if (rect !== undefined && !isDegenerate(rect)) { lastKnownRect.current = rect; setAnchor(rect) }
    }, isWarm() ? WARM_DELAY_MS : HOVER_DELAY_MS)
    armedInstances.add(cancelArm)
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
      const safe = options.safeWithin === undefined ? null : ref.current?.closest(options.safeWithin) ?? null
      if (
        ref.current?.contains(target) === true
        || target.closest('.hover-card, .layout-picker') !== null
        || safe?.contains(target) === true
      ) {
        // Demonstrably still on safe ground: cancel any close a `mouseleave` on the way here started.
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
   * A scroll puts every popup away at once (the document-level listener above closes `openCard`
   * directly), and comes back once the list has stopped moving, if the pointer turns out to be
   * resting on this row.
   *
   * UI-7: rather than every mounted instance scheduling its own settle timer and reading its own
   * `getBoundingClientRect()` — O(rows) timers and layout reads per scroll — the shared listener
   * asks the DOM once, after the whole gesture goes quiet, which element is under the pointer, and
   * dispatches `HOVER_SETTLE_EVENT` at it. Only the instance(s) whose `ref` is that element or an
   * ancestor of it — reached by ordinary event bubbling, not by asking all of them — ever run this.
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
