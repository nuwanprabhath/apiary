/** Keep a placed popover this far inside the window edge. */
export const POPOVER_MARGIN = 8
/** The gap between an anchor and the popover beside it (`HoverCard` keeps its own, wider one). */
export const POPOVER_GAP = 6

/** Whether a box `width` wide starting at `left` still ends inside the window, margin included. */
export function fitsHorizontally(left: number, width: number): boolean {
  return left + width + POPOVER_MARGIN <= window.innerWidth
}

/** A top-aligned popover's top: the anchor's own top, pulled up only as far as staying on screen
 *  needs, and never above the margin. */
export function clampTop(anchorTop: number, height: number): number {
  return Math.max(POPOVER_MARGIN, Math.min(anchorTop, window.innerHeight - height - POPOVER_MARGIN))
}

/** The leftmost `left` that keeps a box `width` wide inside the window, never past the margin. */
export function clampLeft(left: number, width: number): number {
  return Math.max(POPOVER_MARGIN, Math.min(left, window.innerWidth - width - POPOVER_MARGIN))
}

/**
 * Where a popup `width` x `height` goes against an anchor button: under it with the popup's right
 * edge on the anchor's right edge, flipped above when there is no room below, then kept inside the
 * window. Returns viewport coordinates for a `position: fixed` box.
 */
export function placeUnderRightEdge(anchor: DOMRect, size: { width: number; height: number }): { left: number; top: number } {
  const below = anchor.bottom + POPOVER_GAP
  const fitsBelow = below + size.height + POPOVER_MARGIN <= window.innerHeight
  const top = fitsBelow ? below : anchor.top - POPOVER_GAP - size.height
  return { left: clampLeft(anchor.right - size.width, size.width), top: Math.max(POPOVER_MARGIN, top) }
}
