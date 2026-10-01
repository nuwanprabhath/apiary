import type { ProjectNode, SessionNode } from '@shared/types'

/** How many sessions the tree holds, at any depth. */
export function countSessions(nodes: ProjectNode[]): number {
  return nodes.reduce((n, node) => n + node.sessions.length + countSessions(node.children), 0)
}

/** Every session anywhere in the tree, flattened, so pinned ids can be resolved back to rows. */
export function flattenSessions(nodes: ProjectNode[], into = new Map<string, SessionNode>()): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flattenSessions(node.children, into)
  }
  return into
}

/**
 * Each session's *folder* branch, by session id.
 *
 * The pinned section draws rows outside the tree that holds them, so the project node — and with
 * it the branch its worktree is on — is not to hand. The lookup is built alongside the flatten.
 */
export function folderBranches(nodes: ProjectNode[], into = new Map<string, string | null>()): Map<string, string | null> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, node.branch)
    folderBranches(node.children, into)
  }
  return into
}

/** Every folder path in the tree, at every depth — the full list ordering is resolved against. */
export function allFolderPaths(nodes: ProjectNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...allFolderPaths(n.children)])
}

/**
 * The chain of folder paths leading to a session, outermost first.
 *
 * Revealing a session means nothing while the folder holding it is collapsed — the row does not
 * exist to scroll to. These are the folders that have to be opened for it to.
 */
export function pathsToSession(nodes: ProjectNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const here = [...trail, node.path]
    if (node.sessions.some((s) => s.sessionId === id)) return here
    const deeper = pathsToSession(node.children, id, here)
    if (deeper) return deeper
  }
  return null
}
