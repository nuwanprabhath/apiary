/**
 * Which window a tab was dropped on, given where the pointer was released.
 *
 * Moving a tab between windows cannot use drag-and-drop data, because there is none to use: an
 * HTML5 drag started in one `BrowserWindow` delivers no `dragover` or `drop` to another, so the
 * receiving window never hears about the gesture at all. What *does* survive is `dragend` in the
 * window the drag started in, carrying the screen coordinates of the release — so the drop target
 * is worked out from geometry in the main process instead of from an event that never arrives.
 *
 * Kept pure and free of Electron so the rule can be tested: the ambiguity below is the whole
 * reason it is worth testing.
 */

export interface WindowRect {
  id: number
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface Point { x: number; y: number }

function contains(w: WindowRect, p: Point): boolean {
  return p.x >= w.x && p.x <= w.x + w.width && p.y >= w.y && p.y <= w.y + w.height
}

/**
 * The topmost window under `point`, or null for none.
 *
 * Windows overlap, and Electron exposes no z-order, so "topmost" is approximated by most recently
 * focused (`focusOrder`, newest first) — which is what z-order actually follows in practice, and
 * is right for the case that matters: a window the user just dragged from is on top of whatever it
 * covers, so a release over that overlap belongs to it and not to the window underneath.
 *
 * Hidden windows are never a target. A window that has never been focused sorts last rather than
 * being excluded: it is still a window on screen.
 */
export function pickWindowAt(
  windows: WindowRect[],
  focusOrder: number[],
  point: Point,
): number | null {
  const under = windows.filter((w) => w.visible && contains(w, point))
  if (under.length === 0) return null
  const rank = (id: number): number => {
    const i = focusOrder.indexOf(id)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  return [...under].sort((a, b) => rank(a.id) - rank(b.id))[0].id
}
