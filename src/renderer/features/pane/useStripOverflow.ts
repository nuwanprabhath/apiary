import { useCallback, useEffect, useRef, useState } from 'react'
import { wheelScrollsSideways } from '../../ui/wheelScrollsSideways'

export interface StripOverflow {
  /** The strip's ref: the wheel scrolls it sideways, and its overflow is followed. */
  ref: (el: HTMLElement | null) => (() => void) | undefined
  /** Tabs are hidden past that edge. */
  canLeft: boolean
  canRight: boolean
  /** Most of a strip's width towards that side, so the next tabs come fully into view. */
  page: (direction: -1 | 1) => void
  /** A small step towards that side: called on each `dragover` while a tab is held over an arrow. */
  nudge: (direction: -1 | 1) => void
}

/**
 * Which sides of the tab strip hide tabs, for the arrows that scroll it. The hairline scrollbar was
 * the only way to reach a hidden tab with a mouse, and it sat on the tabs' bottom edge: a near miss
 * picked up a tab (or, between tabs, the whole pane) instead. Followed on scroll, on resize, and
 * whenever the tabs change (`tabCount`).
 */
export function useStripOverflow(tabCount: number): StripOverflow {
  const strip = useRef<HTMLElement | null>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback((): void => {
    const el = strip.current
    if (el === null) return
    // A pixel of slack: a fractional scroll width leaves scrollLeft a hair short of the end.
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  const ref = useCallback((el: HTMLElement | null): (() => void) | undefined => {
    strip.current = el
    if (el === null) return undefined
    const unwheel = wheelScrollsSideways(el)
    el.addEventListener('scroll', measure, { passive: true })
    const resized = new ResizeObserver(measure)
    resized.observe(el)
    measure()
    return () => {
      unwheel?.()
      el.removeEventListener('scroll', measure)
      resized.disconnect()
      strip.current = null
    }
  }, [measure])

  // A tab opened or closed changes what overflows without resizing the strip itself.
  useEffect(measure, [measure, tabCount])

  const page = useCallback((direction: -1 | 1): void => {
    const el = strip.current
    if (el !== null) el.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.75), behavior: 'smooth' })
  }, [])

  const nudge = useCallback((direction: -1 | 1): void => {
    const el = strip.current
    if (el !== null) el.scrollLeft += direction * 16
  }, [])

  return { ref, canLeft, canRight, page, nudge }
}
