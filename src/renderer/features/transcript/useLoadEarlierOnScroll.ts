import { type RefObject, useEffect, useRef } from 'react'

/**
 * Loads the earlier page by itself when the reader scrolls to within a screen of the top of what is
 * held. `sentinelRef` is an element above the first row; a fresh observer is made whenever the
 * cursor or the loading state changes, because an observer only reports a change and a page that
 * landed with the sentinel still near the top would otherwise never be followed by the next.
 */
export function useLoadEarlierOnScroll(opts: {
  containerRef: RefObject<HTMLElement | null>
  cursor: number | null
  loadingEarlier: boolean
  loadEarlier: () => void
}): RefObject<HTMLDivElement | null> {
  const { containerRef, cursor, loadingEarlier, loadEarlier } = opts
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = containerRef.current
    const sentinel = sentinelRef.current
    if (root === null || sentinel === null || cursor === null || loadingEarlier) return
    const margin = Math.max(root.clientHeight, 200)
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadEarlier() },
      { root, rootMargin: String(margin) + 'px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [containerRef, cursor, loadingEarlier, loadEarlier])

  return sentinelRef
}
