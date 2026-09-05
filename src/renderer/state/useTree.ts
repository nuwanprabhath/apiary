import { useCallback, useEffect, useState } from 'react'
import type { ProjectNode } from '@shared/types'

export function useTree(query: string): {
  tree: ProjectNode[]
  loading: boolean
  reload: () => void
} {
  const [tree, setTree] = useState<ProjectNode[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.apiary
      .tree(query)
      .then((next) => { if (!cancelled) setTree(next) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, nonce])

  // The main process rescans when session files change on disk.
  useEffect(() => window.apiary.onTreeChanged(reload), [reload])

  return { tree, loading, reload }
}
