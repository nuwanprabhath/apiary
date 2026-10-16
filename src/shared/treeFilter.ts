import type { ProjectNode } from './types'
import { fuzzyScore } from './fuzzy'
import { countSessions } from './treeWalk'

/** Results shown before "showing first 200" replaces the rest. The caller applies it after ranking
 *  (`rankSessions`), never `filterTreeLocal`: capping first would keep matches in tree-walk order
 *  and lose a better one found later. */
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

/**
 * Title/path/branch filtering, run in the renderer against the cached, unfiltered tree —
 * `matchedByContent` folds in whatever the main process's FTS index additionally matched.
 * Returns every match, uncapped (see `SEARCH_RESULT_CAP`); `totalMatches` is the true count.
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
