import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'

export function useTree(query: string): {
  tree: ProjectNode[]
  loading: boolean
  reload: () => void
  /** Reloads and resolves with the tree it just loaded, for a caller that wants to say what
   *  changed — the Refresh button compares the count before and after. */
  reloadNow: () => Promise<ProjectNode[]>
} {
  const [tree, setTree] = useState<ProjectNode[]>([])
  const [loading, setLoading] = useState(true)
  // The query as of the latest render, so `reloadNow` can be a stable function that always asks
  // for the list currently on screen rather than the one it was created with.
  const queryRef = useRef(query)
  queryRef.current = query
  /**
   * Which load is the newest. Loads are started from three places (a query change, the watcher,
   * the Refresh button) and can overlap, so the answer that arrives last is not necessarily the
   * answer to the most recent question: without this, a slow load for an old query could land
   * after a fast one and put a stale list on screen.
   */
  const latest = useRef(0)

  const reloadNow = useCallback(async (): Promise<ProjectNode[]> => {
    const id = ++latest.current
    setLoading(true)
    const next = await window.apiary.tree(queryRef.current)
    if (latest.current === id) { setTree(next); setLoading(false) }
    // Returned either way: the caller asked this question and deserves its answer, even if the
    // screen has since moved on to a newer one.
    return next
  }, [])

  const reload = useCallback(() => { void reloadNow() }, [reloadNow])

  useEffect(() => { void reloadNow() }, [query, reloadNow])

  // The main process rescans when session files change on disk.
  useEffect(() => window.apiary.onTreeChanged(reload), [reload])

  return { tree, loading, reload, reloadNow }
}
