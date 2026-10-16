import { type RefObject, useLayoutEffect, useRef } from 'react'
import type { ProjectNode } from '@shared/types'
import { pathsToSession } from './treeUtils'

/**
 * Scrolls a revealed session's row into view, opening the folders above it first.
 *
 * Re-runs on tree and collapse changes as well as on `revealId`, because the row usually does not
 * exist yet: the tree arrives asynchronously and a folder may need opening first.
 *
 * `scrolledTo` stops it fighting the user: once scrolled to, later renders leave the list alone.
 * `block: 'nearest'` leaves an already-visible row where it is.
 */
export function useRevealSession(
  revealId: string | null,
  tree: ProjectNode[],
  collapsed: Set<string>,
  onCollapsedChange: (next: Set<string>) => void,
  listRef: RefObject<HTMLElement | null>,
): void {
  const scrolledTo = useRef<string | null>(null)
  /**
   * Which session the folders have already been opened for. Separate from `scrolledTo`: the
   * expand step re-runs on every `collapsed` change, so without this latch the user collapsing the
   * folder holding the open session would be undone by the render it caused. The scroll still
   * retries, as it must wait for the row to exist.
   */
  const expandedFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (revealId === null || scrolledTo.current === revealId) return

    const chain = pathsToSession(tree, revealId)
    if (chain !== null && expandedFor.current !== revealId && chain.some((path) => collapsed.has(path))) {
      expandedFor.current = revealId
      const next = new Set(collapsed)
      for (const path of chain) next.delete(path)
      onCollapsedChange(next)
      return
    }

    const row = listRef.current?.querySelector(`[data-session-id="${CSS.escape(revealId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    scrolledTo.current = revealId
  }, [revealId, tree, collapsed, onCollapsedChange, listRef])
}
