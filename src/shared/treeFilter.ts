import type { ProjectNode } from './types'
import { fuzzyScore } from './fuzzy'

/** Results shown before "showing first 200" replaces the rest — applied by the caller once results
 *  are ranked (see `rankSessions` in `./sessionRank`), never by `filterTreeLocal` itself. Capping
 *  here, before ranking, would keep whichever matches happen to come first in tree-walk order and
 *  discard better matches that come later — an exact title match in the fiftieth project losing to
 *  weak subsequence matches in the first forty-nine, which is exactly the bug this was found doing. */
export const SEARCH_RESULT_CAP = 200

function projectMatches(node: ProjectNode, query: string): boolean {
  return (
    fuzzyScore(query, node.label) !== null ||
    fuzzyScore(query, node.path) !== null ||
    (node.branch !== null && fuzzyScore(query, node.branch) !== null)
  )
}

function filterNode(node: ProjectNode, query: string, alsoMatched: Set<string>): ProjectNode | null {
  if (projectMatches(node, query)) return node
  const sessions = node.sessions.filter(
    (s) => fuzzyScore(query, s.title) !== null || alsoMatched.has(s.sessionId),
  )
  const children = node.children
    .map((c) => filterNode(c, query, alsoMatched))
    .filter((c): c is ProjectNode => c !== null)
  if (sessions.length === 0 && children.length === 0) return null
  return { ...node, sessions, children }
}

function countSessions(nodes: ProjectNode[]): number {
  return nodes.reduce((n, node) => n + node.sessions.length + countSessions(node.children), 0)
}

/**
 * Title/path/branch filtering, run in the renderer against the cached, unfiltered tree —
 * `matchedByContent` folds in whatever the main process's FTS index additionally matched, exactly
 * as `AppService.tree()` used to before this moved.
 *
 * Returns every match, uncapped. The cap is the caller's job, applied *after* `rankSessions` has
 * ordered the full match set — this function used to cap here instead, which meant showing
 * whichever `SEARCH_RESULT_CAP` sessions were encountered first while walking folders, not the
 * `SEARCH_RESULT_CAP` best matches. `totalMatches` is still the true count, for the "showing first
 * 200" note.
 */
export function filterTreeLocal(
  tree: ProjectNode[],
  query: string,
  matchedByContent: Set<string>,
): { tree: ProjectNode[]; totalMatches: number } {
  if (query.trim() === '') return { tree, totalMatches: countSessions(tree) }
  const filtered = tree.map((n) => filterNode(n, query, matchedByContent)).filter((n): n is ProjectNode => n !== null)
  return { tree: filtered, totalMatches: countSessions(filtered) }
}
