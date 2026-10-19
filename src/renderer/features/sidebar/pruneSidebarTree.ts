import type { ProjectNode } from '@shared/types'

const MS_PER_DAY = 86_400_000

export interface PruneOptions {
  /** "Hide old sessions": the days a session may go unused, or null when that setting is off. */
  days: number | null
  now: number
  /** Sessions that stay whatever their age or folder: pinned and open in a tab (running ones always stay). */
  keep: ReadonlySet<string>
}

/**
 * The main tree without the sessions there is no reason to list: those whose folder is gone (they
 * cannot be resumed) and, with "hide old sessions" on, those not used for `days` days, by the same
 * `lastActiveAtMs` the row shows as its age. A folder is dropped when this emptied it; one that had
 * nothing to begin with is left alone. A folder with a visible child folder stays, so a recent
 * worktree is never orphaned. Search does not call this: it reads the unfiltered tree.
 */
export function pruneSidebarTree(tree: ProjectNode[], opts: PruneOptions): ProjectNode[] {
  const cutoff = opts.days === null ? null : opts.now - opts.days * MS_PER_DAY
  const prune = (node: ProjectNode): ProjectNode | null => {
    const sessions = node.sessions.filter((s) => s.isLive || opts.keep.has(s.sessionId) || (
      s.cwdExists && (cutoff === null || s.lastActiveAtMs === null || s.lastActiveAtMs >= cutoff)
    ))
    const children = node.children.map(prune).filter((c): c is ProjectNode => c !== null)
    const hadContent = node.sessions.length > 0 || node.children.length > 0
    if (hadContent && sessions.length === 0 && children.length === 0) return null
    const unchanged = sessions.length === node.sessions.length
      && children.length === node.children.length && children.every((c, i) => c === node.children[i])
    return unchanged ? node : { ...node, sessions, children }
  }
  const out = tree.map(prune).filter((n): n is ProjectNode => n !== null)
  // The same array when nothing went, so what is memoised on the tree stays put.
  return out.length === tree.length && out.every((n, i) => n === tree[i]) ? tree : out
}
