import { type RefObject, useLayoutEffect, useRef } from 'react'
import type { ProjectNode } from '@shared/types'
import { pathsToSession } from './treeUtils'

/**
 * Scrolls a revealed session's row into view, opening the folders above it first.
 *
 * Re-runs on tree and collapse changes as well as on `revealId`, because the row usually is not
 * rendered at the moment the reveal is asked for: the tree arrives asynchronously, and a folder
 * may need opening before the row exists at all. Each pass does the next thing it can and lets
 * the resulting render bring it back.
 *
 * `scrolledTo` is what stops it fighting the user: once a session has been scrolled to, later
 * renders leave the list alone, so a tree refresh while you are scrolling by hand does not yank
 * you back. `block: 'nearest'` likewise leaves an already-visible row exactly where it is.
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
   * Which session the folders have already been opened for.
   *
   * Separate from `scrolledTo`, and the reason a folder can be collapsed at all. The expand step
   * re-runs on every `collapsed` change, and collapsing a folder *is* a `collapsed` change — so
   * with only the scroll latch to stop it, a click on the chevron of the folder holding the open
   * session was undone by the very render it caused. The folder shut and sprang back open, which
   * is exactly what "clicking B or C won't collapse that folder" looked like from outside, and
   * why turning the setting off appeared to fix it.
   *
   * Revealing is a response to the *selection changing*, not a standing rule that the selected
   * session's folders stay open. Once this has opened them for a given id, the user's own
   * collapsing wins until a different session is revealed. The scroll below still retries, since
   * it is what has to wait for the row to exist.
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
