/** A window's saved position and size, as `settings.json` and the layout file keep it. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A plain rectangle, not `Electron.Display`, so this module needs no Electron import. */
export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Minimum overlap, in pixels, in each dimension for a saved position to count as "on screen": what
 * matters is that the user can grab the title bar and drag the window back, and a pixel of corner
 * overlap gives no grab target. 40px is a clickable strip of title bar, smaller than any real one.
 */
const MIN_REACHABLE_OVERLAP = 40

/**
 * Saved bounds can point at a display that is gone (an unplugged monitor) or barely clip one, so a
 * saved rect is honoured only when it overlaps some connected display's work area by at least
 * MIN_REACHABLE_OVERLAP pixels in both dimensions.
 */
export function boundsAreOnScreen(bounds: WindowBounds, displays: DisplayRect[]): boolean {
  return displays.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapWidth >= MIN_REACHABLE_OVERLAP && overlapHeight >= MIN_REACHABLE_OVERLAP
  })
}
