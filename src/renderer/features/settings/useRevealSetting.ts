import { type RefObject, useEffect } from 'react'
import type { SettingEntry } from './settingsIndex'

const FOUND_MS = 1800
/** Frames to wait for a section that draws its controls after it loads (pets). */
const MAX_FRAMES = 40

const ROW = '.settings-row, .settings-inline, .busy-settings, .resident-field, .theme-describe, .settings-plugin'

const selectorFor = (testId: string): string =>
  (testId.endsWith('*') ? `[data-testid^="${testId.slice(0, -1)}"]` : `[data-testid="${testId}"]`)

/**
 * Scrolls the pane to the control of `target` and marks its row for a moment, once `ready` (the
 * section is drawn). A control that is not on screen (the interval field of a switched-off option)
 * falls through to the next id of the entry, and the pane to its top when none is there.
 */
export function useRevealSetting(
  pane: RefObject<HTMLElement | null>, target: SettingEntry | null, ready: boolean,
): void {
  useEffect(() => {
    if (target === null || !ready) return
    let frame = 0
    let frames = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let marked: HTMLElement | null = null
    const find = (): void => {
      const root = pane.current
      if (root === null) return
      for (const id of target.testIds) {
        const el = root.querySelector<HTMLElement>(selectorFor(id))
        if (el === null) continue
        marked = el.closest<HTMLElement>(ROW) ?? el
        marked.scrollIntoView({ block: 'center' })
        marked.dataset.found = 'true'
        const row = marked
        timer = setTimeout(() => { delete row.dataset.found }, FOUND_MS)
        return
      }
      frames += 1
      if (frames < MAX_FRAMES) frame = requestAnimationFrame(find)
      else root.scrollTo({ top: 0 })
    }
    find()
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      if (marked !== null) delete marked.dataset.found
    }
  }, [pane, target, ready])
}
