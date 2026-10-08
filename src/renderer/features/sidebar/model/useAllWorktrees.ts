import { useEffect, useState } from 'react'
import type { FolderWorktree, ProjectNode } from '@shared/types'
import { worktreesOf } from '../../../state/git'

/**
 * The worktrees of each folder in `paths`, asked of main whenever `paths` or the tree's top-level
 * folders change, or `refreshNonce` is bumped — a worktree added or removed on disk shows up with
 * the next rescan, like everything else in the sidebar. A folder main cannot list (it has gone, or
 * is not a repository) simply adds nothing.
 */
export function useAllWorktrees(
  paths: string[], tree: ProjectNode[], refreshNonce = 0,
  /** Changes when a worktree is made, so git is asked again even if `paths` stayed the same. */
  madeSignature = '',
): ReadonlyMap<string, FolderWorktree[]> {
  const [found, setFound] = useState<ReadonlyMap<string, FolderWorktree[]>>(() => new Map())
  const key = paths.join('\n')
  // UI-11: `tree` gets a new array identity on every `treeChanged` — about once a second while a
  // session is live — but only the *set of top-level folder paths* is actually read below. Keying
  // the effect on a signature of just that means a rescan whose folders are unchanged (the common
  // case; a session's transcript growing does not add or remove a project) does not re-run a git
  // process per folder in `showAllWorktrees`. A worktree added or removed on disk without also
  // changing that set (no session has been started in it yet) still reaches here through
  // `refreshNonce`, which the sidebar's explicit Refresh button bumps.
  const treePathsSignature = tree.map((n) => n.path).join('\n')
  useEffect(() => {
    let cancelled = false
    const wanted = key === '' ? [] : key.split('\n')
    // Only folders the tree actually has: a stale path from another machine's layout, or a folder
    // since removed, is not one main will list.
    const present = new Set(treePathsSignature === '' ? [] : treePathsSignature.split('\n'))
    void Promise.all(wanted.filter((p) => present.has(p)).map(async (p) => {
      return [p, await worktreesOf(p)] as const
    })).then((entries) => { if (!cancelled) setFound(new Map(entries)) })
    return () => { cancelled = true }
  }, [key, treePathsSignature, refreshNonce, madeSignature])
  return found
}
