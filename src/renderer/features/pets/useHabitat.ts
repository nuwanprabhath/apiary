import { useEffect, useState } from 'react'
import type { Habitat, Rect } from '@shared/pets/habitat'

const RAIL = '[data-testid="sidebar-rail"]'
const FLOOR = '[data-testid="status-bar-floor"]'

function rectOf(el: Element | null): Rect | null {
  if (el === null) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
}

const same = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

/**
 * Measures where pets may be: the collapsed sidebar's rail and the free stretch of the status bar
 * (see `@shared/pets/habitat`). Re-measured when either is resized, when the window is, and when
 * `sidebarHidden` changes (which adds or removes the rail). Null while there is no bar to stand on.
 */
export function useHabitat(active: boolean, sidebarHidden: boolean): Habitat | null {
  const [habitat, setHabitat] = useState<Habitat | null>(null)
  useEffect(() => {
    if (!active) { setHabitat(null); return }
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bar = rectOf(document.querySelector(FLOOR))
        const rail = rectOf(document.querySelector(RAIL))
        setHabitat((cur) => {
          if (bar === null) return null
          if (cur !== null && same(cur.bar, bar) && same(cur.rail, rail)) return cur
          return { bar, rail }
        })
      })
    }
    const observer = new ResizeObserver(measure)
    let observed = 0
    const observe = (): void => {
      const els = [document.querySelector(FLOOR), document.querySelector(RAIL)].filter((e): e is Element => e !== null)
      if (els.length === observed) return
      observer.disconnect()
      for (const el of els) observer.observe(el)
      observed = els.length
    }
    observe()
    measure()
    // The bar renders once pets are on; it may not be in the page on this effect's first run. Wait
    // for it to appear, then stop watching the page: the ResizeObserver takes it from there.
    const appeared = new MutationObserver(() => {
      observe()
      measure()
      if (document.querySelector(FLOOR) !== null) appeared.disconnect()
    })
    if (document.querySelector(FLOOR) === null) appeared.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      appeared.disconnect()
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active, sidebarHidden])
  return habitat
}
