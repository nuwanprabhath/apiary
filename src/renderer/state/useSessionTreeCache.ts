import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'

/** The unfiltered tree, fetched once and refreshed only on the watcher's `onTreeChanged` signal or
 *  an explicit reload — never on a keystroke. Filtering against it happens elsewhere. */
export function useSessionTreeCache(): {
  rawTree: ProjectNode[]
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const [rawTree, setRawTree] = useState<ProjectNode[]>([])
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const reloadNow = useCallback(async (): Promise<ProjectNode[]> => {
    const id = ++latest.current
    setLoading(true)
    const next = await window.apiary.tree()
    if (latest.current === id) { setRawTree(next); setLoading(false) }
    return next
  }, [])

  const reload = useCallback(() => { void reloadNow() }, [reloadNow])
  useEffect(() => { void reloadNow() }, [reloadNow])
  useEffect(() => window.apiary.onTreeChanged(reload), [reload])

  return { rawTree, loading, reload, reloadNow }
}
