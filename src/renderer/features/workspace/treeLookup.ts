import type { ProjectNode, SessionNode } from '@shared/types'

export function findSessionById(nodes: ProjectNode[], id: string): SessionNode | null {
  for (const node of nodes) {
    const hit = node.sessions.find((s) => s.sessionId === id)
    if (hit) return hit
    const inChild = findSessionById(node.children, id)
    if (inChild) return inChild
  }
  return null
}

/** Every session in the tree by id, at any depth. */
export function flattenTree(nodes: ProjectNode[], into = new Map<string, SessionNode>()): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flattenTree(node.children, into)
  }
  return into
}

/**
 * Finds a session by working directory among ids not present in `excludeIds` — used to spot the
 * one session the watcher just discovered in a folder a "new session" request was made against,
 * without mistaking an already-existing session in that same (possibly non-empty) folder for it.
 */
export function findNewSessionByCwd(
  nodes: ProjectNode[],
  cwd: string,
  excludeIds: Set<string>,
): SessionNode | null {
  for (const node of nodes) {
    const hit = node.sessions.find((s) => s.cwd === cwd && !excludeIds.has(s.sessionId))
    if (hit) return hit
    const inChild = findNewSessionByCwd(node.children, cwd, excludeIds)
    if (inChild) return inChild
  }
  return null
}
