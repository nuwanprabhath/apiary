import type { WindowBounds } from './settings'

/** A plain rectangle shape — deliberately not Electron.Display, so this module stays
 *  dependency-free and testable without pulling Electron into the import graph. */
export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Minimum overlap, in pixels, required in each dimension for a saved window position to be
 * considered "on screen". The property that actually matters isn't any overlap at all — it's
 * that the user can grab the title bar and drag the window back into full view. A single
 * pixel of corner overlap satisfies "some intersection" but gives no usable grab target. 40px
 * approximates a comfortably clickable strip of title bar (larger than a cursor hit-target,
 * smaller than any real title bar), so it screens out unreachable corner-only overlaps while
 * still accepting a legitimately half-offscreen window, whose overlap with some display is
 * typically hundreds of pixels.
 */
const MIN_REACHABLE_OVERLAP = 40

/**
 * Saved bounds can point at a display that no longer exists (an external monitor unplugged
 * since the last run), or at a position only barely clipping a connected display. Restoring
 * either verbatim would place the window out of comfortable reach, so a saved rect is only
 * honoured when it overlaps some currently connected display's work area by at least
 * MIN_REACHABLE_OVERLAP pixels in both dimensions — enough for the user to grab the title bar.
 */
export function boundsAreOnScreen(bounds: WindowBounds, displays: DisplayRect[]): boolean {
  return displays.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapWidth >= MIN_REACHABLE_OVERLAP && overlapHeight >= MIN_REACHABLE_OVERLAP
  })
}
