import type { ProjectNode } from '@shared/types'

const MS_PER_DAY = 86_400_000

export interface HideOldOptions {
  days: number
  now: number
  /** Sessions that stay however old they are: pinned and open in a tab (running ones always stay). */
  keep: ReadonlySet<string>
}

/**
 * The main tree without the sessions not used for `days` days, by the same `lastActiveAtMs` the
 * row shows as its age. A folder is dropped when the filter emptied it; one that had nothing to
 * begin with is left alone. A folder with a visible child folder stays, so a recent worktree is
 * never orphaned. Search does not call this: it reads the unfiltered tree.
 */
export function hideOldSessions(tree: ProjectNode[], opts: HideOldOptions | null): ProjectNode[] {
  if (opts === null) return tree
  const cutoff = opts.now - opts.days * MS_PER_DAY
  const prune = (node: ProjectNode): ProjectNode | null => {
    const sessions = node.sessions.filter(
      (s) => s.lastActiveAtMs === null || s.lastActiveAtMs >= cutoff || s.isLive || opts.keep.has(s.sessionId),
    )
    const children = node.children.map(prune).filter((c): c is ProjectNode => c !== null)
    const hadContent = node.sessions.length > 0 || node.children.length > 0
    if (hadContent && sessions.length === 0 && children.length === 0) return null
    const unchanged = sessions.length === node.sessions.length
      && children.length === node.children.length && children.every((c, i) => c === node.children[i])
    return unchanged ? node : { ...node, sessions, children }
  }
  return tree.map(prune).filter((n): n is ProjectNode => n !== null)
}
