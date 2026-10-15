import { type RefObject, useEffect } from 'react'
import { requireWindowWidth } from '../../state/windowChrome'
import { MIN_PANE_WIDTH } from './PaneDividers'

/**
 * Keeps the window wide enough for every pane column at its minimum beside what is not panes (the
 * sidebar, the gaps): main raises the window's minimum width to that and widens a narrower window
 * (`WindowManager.requireWidth`). Before, three columns in a 900 px window ran the last pane off
 * the edge, where nothing could reach it. Reported whenever the pane area or the window resizes.
 */
export function useWindowFitsPanes(content: RefObject<HTMLElement | null>, columns: number): void {
  useEffect(() => {
    const el = content.current
    if (el === null) return
    let reported = -1
    const report = (): void => {
      const notPanes = window.innerWidth - el.getBoundingClientRect().width
      const needed = Math.ceil(notPanes + columns * MIN_PANE_WIDTH)
      if (needed === reported) return
      reported = needed
      requireWindowWidth(needed)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => { observer.disconnect(); window.removeEventListener('resize', report) }
  }, [content, columns])
}
