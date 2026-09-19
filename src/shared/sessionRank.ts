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
  // Deliberately not `folderPath`: every session under a project shares its node's path, so
  // checking it here would put every sibling in tier 3 the moment one of them (or the folder
  // itself) matches by path — exactly the over-matching the second test below guards against.
  // `session.cwd` is the per-session equivalent and is specific enough to keep the tiers apart.
  if (
    fuzzyScore(query, session.cwd) !== null ||
    fuzzyScore(query, folderLabel) !== null ||
    (folderBranch !== null && fuzzyScore(query, folderBranch) !== null)
  ) return 3
  if (matchedByContent.has(session.sessionId)) return 4
  return null
}

/**
 * Flattens the (already filtered, but deliberately *uncapped* — see `filterTreeLocal`) tree into
 * one ranked list: exact title, then prefix, then subsequence, then path/branch, then content —
 * ties broken by recency. Every session here already matched *something*, so a `null` tier here
 * would mean `filterTreeLocal` and this function have disagreed about what matches, which is a bug
 * in one of them rather than something to filter out quietly.
 *
 * Ranks the *entire* match set before anything is capped: `filterTreeLocal` no longer caps, so an
 * exact title match buried in the two-hundred-and-first result sorts to the top here instead of
 * being discarded before this function ever sees it. The caller caps the result of this function,
 * not its input.
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
