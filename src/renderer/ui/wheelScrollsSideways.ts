/**
 * A `ref` that makes the mouse wheel scroll a horizontal strip (a tab bar), as VS Code's tab bar
 * does: a mouse has only a vertical wheel, and without this the tabs past the edge were reachable
 * only by the hairline scrollbar. A sideways swipe (a trackpad's own horizontal scroll) is left to
 * the browser, and so is a wheel over a strip with nothing to scroll. Non-passive, or the wheel
 * would also scroll whatever is behind the strip.
 */
export function wheelScrollsSideways(el: HTMLElement | null): (() => void) | undefined {
  if (el === null) return undefined
  const onWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
    // A line or a page of wheel is a few dozen pixels a step; a pixel delta is used as it is.
    const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1
    el.scrollLeft += e.deltaY * step
    e.preventDefault()
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => { el.removeEventListener('wheel', onWheel) }
}
