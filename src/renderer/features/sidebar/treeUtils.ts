import type { ProjectNode } from '@shared/types'

/** The pinned section draws rows outside the tree that holds them, so the project node's branch is not to hand. */
export function folderBranches(nodes: ProjectNode[], into = new Map<string, string | null>()): Map<string, string | null> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, node.branch)
    folderBranches(node.children, into)
  }
  return into
}

export function findFolder(nodes: ProjectNode[], path: string): ProjectNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const inner = findFolder(node.children, path)
    if (inner !== null) return inner
  }
  return null
}

export function allFolderPaths(nodes: ProjectNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...allFolderPaths(n.children)])
}

/** The folders, outermost first, that must be open for the session's row to exist. */
export function pathsToSession(nodes: ProjectNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const here = [...trail, node.path]
    if (node.sessions.some((s) => s.sessionId === id)) return here
    const deeper = pathsToSession(node.children, id, here)
    if (deeper) return deeper
  }
  return null
}
