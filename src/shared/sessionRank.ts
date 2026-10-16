import type { ProjectNode, SessionNode } from './types'
import { fuzzyScore } from './fuzzy'

export type MatchTier = 0 | 1 | 2 | 3 | 4

export interface RankedSession {
  session: SessionNode
  /** The folder the session's worktree/project node is labelled with — the row's subtitle. */
  worktreeLabel: string
  tier: MatchTier
}

function tierFor(
  query: string,
  session: SessionNode,
  folderLabel: string,
  folderBranch: string | null,
  matchedByContent: Set<string>,
): MatchTier | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  const title = session.title.toLowerCase()
  if (title === q) return 0
  if (title.startsWith(q)) return 1
  if (fuzzyScore(query, session.title) !== null) return 2
  // Not the folder's path: every session under a project shares it, so one path match would put
  // every sibling in tier 3. `session.cwd` is per session.
  if (
    fuzzyScore(query, session.cwd) !== null ||
    fuzzyScore(query, folderLabel) !== null ||
    (folderBranch !== null && fuzzyScore(query, folderBranch) !== null)
  ) return 3
  if (matchedByContent.has(session.sessionId)) return 4
  return null
}

/**
 * Flattens the filtered, uncapped (see `filterTreeLocal`) tree into one ranked list: exact title,
 * prefix, subsequence, path/branch, content — ties broken by recency. Every session here already
 * matched, so a `null` tier means `filterTreeLocal` and this function disagree about what matches.
 *
 * Ranks the *entire* match set before anything is capped, so an exact title match deep in the
 * results still sorts to the top. The caller caps the result, not the input.
 */
export function rankSessions(
  tree: ProjectNode[],
  query: string,
  matchedByContent: Set<string>,
): RankedSession[] {
  const out: RankedSession[] = []
  const walk = (nodes: ProjectNode[]): void => {
    for (const node of nodes) {
      for (const session of node.sessions) {
        const tier = tierFor(query, session, node.label, node.branch, matchedByContent)
        if (tier !== null) out.push({ session, worktreeLabel: node.label, tier })
      }
      walk(node.children)
    }
  }
  walk(tree)
  return out.sort((a, b) => (
    a.tier - b.tier || (b.session.lastActiveAtMs ?? 0) - (a.session.lastActiveAtMs ?? 0)
  ))
}
