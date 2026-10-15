/**
 * The window's minimum width follows its layout: wide enough for every pane at its minimum beside
 * the sidebar. Without it, three columns in a 900 px window ran the last pane off the edge, where
 * nothing could reach it. Kept free of Electron so the geometry can be tested.
 */

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Where a window narrower than `width` goes once widened: as wide as asked (or as the screen allows),
 * moved left only as far as it must to stay on the screen. Null when it is wide enough already.
 */
export function widenedBounds(bounds: Rect, workArea: Rect, width: number): Rect | null {
  if (bounds.width >= width) return null
  const next = Math.min(width, workArea.width)
  if (next <= bounds.width) return null
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - next))
  return { ...bounds, x, width: next }
}

/** The minimum a window keeps: what its kind needs (900, or 520 for a detached one), or more. */
export function minimumWidth(base: number, required: number): number {
  return Math.max(base, Math.ceil(required))
}
