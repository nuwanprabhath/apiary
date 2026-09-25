import { useEffect, useState } from 'react'
import type { FolderWorktree, ProjectNode } from '@shared/types'

/**
 * The worktrees of each folder in `paths`, asked of main whenever `paths` or the tree changes — a
 * worktree added or removed on disk shows up with the next rescan, like everything else in the
 * sidebar. A folder main cannot list (it has gone, or is not a repository) simply adds nothing.
 */
export function useAllWorktrees(paths: string[], tree: ProjectNode[]): ReadonlyMap<string, FolderWorktree[]> {
  const [found, setFound] = useState<ReadonlyMap<string, FolderWorktree[]>>(() => new Map())
  const key = paths.join('\n')
  useEffect(() => {
    let cancelled = false
    const wanted = key === '' ? [] : key.split('\n')
    // Only folders the tree actually has: a stale path from another machine's layout, or a folder
    // since removed, is not one main will list.
    const present = new Set(tree.map((n) => n.path))
    void Promise.all(wanted.filter((p) => present.has(p)).map(async (p) => {
      const list = await window.apiary.listWorktrees(p).catch((): FolderWorktree[] => [])
      return [p, list] as const
    })).then((entries) => { if (!cancelled) setFound(new Map(entries)) })
    return () => { cancelled = true }
  }, [key, tree])
  return found
}
