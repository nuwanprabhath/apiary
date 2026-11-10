import type { ProjectNode, SessionNode } from '@shared/types'

function sameSession(a: SessionNode, b: SessionNode): boolean {
  return a.sessionId === b.sessionId && a.title === b.title && a.cwd === b.cwd
    && a.gitBranch === b.gitBranch && a.lastActiveAtMs === b.lastActiveAtMs
    && a.messageCount === b.messageCount && a.isLive === b.isLive
    && a.cwdExists === b.cwdExists && a.note === b.note
}

/** `next`'s elements, each replaced by `prev`'s object when it came out identical; `prev` when all did. */
function shareList<T>(prev: readonly T[], next: T[], share: (p: T | undefined, n: T) => T): T[] {
  const out = next.map((n, i) => share(prev[i], n))
  return out.length === prev.length && out.every((n, i) => n === prev[i]) ? (prev as T[]) : out
}

function shareProject(prev: ProjectNode | undefined, next: ProjectNode, prevAll: ReadonlyMap<string, ProjectNode>): ProjectNode {
  const p = prevAll.get(next.path) ?? prev
  const prevSessions = new Map(p?.sessions.map((s) => [s.sessionId, s]))
  const sessions = shareList(p?.sessions ?? [], next.sessions, (_o, n) => {
    const old = prevSessions.get(n.sessionId)
    return old !== undefined && sameSession(old, n) ? old : n
  })
  const prevKids = new Map(p?.children.map((c) => [c.path, c]))
  const children = shareList(p?.children ?? [], next.children, (_o, n) => shareProject(prevKids.get(n.path), n, prevKids))
  if (p !== undefined && p.path === next.path && p.label === next.label && p.branch === next.branch
    && p.isWorktree === next.isWorktree && sessions === p.sessions && children === p.children) return p
  return { ...next, sessions, children }
}

/** Nodes equal to the previous fetch keep their old object, so memoised rows skip the render. */
export function shareTree(previous: ProjectNode[], next: ProjectNode[]): ProjectNode[] {
  const byPath = new Map(previous.map((p) => [p.path, p]))
  return shareList(previous, next, (_o, n) => shareProject(byPath.get(n.path), n, byPath))
}
