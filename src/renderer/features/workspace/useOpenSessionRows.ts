import { useEffect, useMemo } from 'react'
import type { SessionNode } from '@shared/types'
import { treeStore } from '../../state/treeStore'
import { findSessionById, flattenTree } from '@shared/treeWalk'
import { useWorkspace } from './useWorkspaceSelector'
import { useWorkspaceDispatch } from './workspaceContext'
import { background } from '../../state/policy'

/** Keeps `openSessions` — the row behind every open tab — current as the tree changes, and filled
 *  in for a tab that arrived as a bare key. */
export function useOpenSessionRows(): void {
  const dispatch = useWorkspaceDispatch()
  const { layout, pending, openSessions } = useWorkspace()
  const columns = layout.panes
  const openKeysSignature = useMemo(
    () => [...new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))].sort((a, b) => a.localeCompare(b)).join(' '),
    [columns],
  )

  /**
   * Keeps the rows behind the open tabs current: titles change (Claude writes one asynchronously)
   * and a session goes live or stops, so a frozen copy would show stale text and resume state.
   */
  useEffect(() => treeStore.onChanged(() => {
    // Re-run on every `treeChanged`, so a failed read just leaves the rows one refresh stale.
    background(treeStore.current().then((nodes) => {
      // One flatten instead of one `findSessionById` walk per open tab.
      dispatch({ type: 'openSessions/refresh', known: flattenTree(nodes) })
    }), 'refresh')
  }), [dispatch])

  /** Fills in the SessionNode behind a tab dropped in from another window, which arrives as a bare key. */
  useEffect(() => {
    const keys = openKeysSignature === '' ? [] : openKeysSignature.split(' ')
    const unknown = keys.filter((k) => !pending.has(k) && !openSessions.has(k))
    if (unknown.length === 0) return
    let cancelled = false
    // A failed read is retried by the refresh effect above on the next tree change.
    background(treeStore.current().then((nodes) => {
      if (cancelled) return
      const found = unknown
        .map((k) => findSessionById(nodes, k))
        .filter((n): n is SessionNode => n !== null && n !== undefined)
      if (found.length === 0) return
      dispatch({ type: 'openSessions/merge', nodes: found })
    }), 'refresh')
    return () => { cancelled = true }
  }, [openKeysSignature, pending, openSessions, dispatch])
}
