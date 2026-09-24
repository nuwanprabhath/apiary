import { basename } from 'node:path'
import { UNTITLED_SESSION, type ProjectNode, type SessionNode } from '@shared/types'
import type { StoredProject, StoredSession } from '../store/sessionStore'

function toSessionNode(
  s: StoredSession,
  liveIds: Set<string>,
  cwdExists: (path: string) => boolean,
): SessionNode {
  const cwd = s.cwd ?? ''
  return {
    kind: 'session',
    sessionId: s.sessionId,
    title: s.title ?? s.firstPrompt ?? UNTITLED_SESSION,
    cwd,
    gitBranch: s.gitBranch,
    lastActiveAtMs: s.lastActiveAtMs,
    messageCount: s.messageCount,
    isLive: liveIds.has(s.sessionId),
    cwdExists: cwd !== '' && cwdExists(cwd),
    note: s.note,
  }
}

function emptyNode(path: string, over: Partial<ProjectNode> = {}): ProjectNode {
  return {
    kind: 'project',
    path,
    label: basename(path) || path,
    branch: null,
    isWorktree: false,
    children: [],
    sessions: [],
    ...over,
  }
}

export function buildTree(
  projects: StoredProject[],
  sessions: StoredSession[],
  liveIds: Set<string>,
  cwdExists: (path: string) => boolean,
): ProjectNode[] {
  const byProject = new Map<string, StoredSession[]>()
  for (const s of sessions) {
    const list = byProject.get(s.projectPath) ?? []
    list.push(s)
    byProject.set(s.projectPath, list)
  }

  const roots = new Map<string, ProjectNode>()

  const rootFor = (path: string): ProjectNode => {
    let node = roots.get(path)
    if (!node) {
      node = emptyNode(path)
      roots.set(path, node)
    }
    return node
  }

  for (const p of projects) {
    const own = (byProject.get(p.path) ?? [])
      .map((s) => toSessionNode(s, liveIds, cwdExists))
      .sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0))

    if (p.isWorktree && p.repoRoot && p.repoRoot !== p.path) {
      // Attach under the parent repo, creating a container node if the parent has no sessions.
      const parent = rootFor(p.repoRoot)
      parent.children.push(
        emptyNode(p.path, { branch: p.branch, isWorktree: true, sessions: own }),
      )
    } else {
      const node = rootFor(p.path)
      node.branch = p.branch
      node.sessions = own
    }
  }

  const result = [...roots.values()]
  for (const node of result) {
    node.children.sort((a, b) => a.label.localeCompare(b.label))
  }
  return result.sort((a, b) => a.label.localeCompare(b.label))
}
