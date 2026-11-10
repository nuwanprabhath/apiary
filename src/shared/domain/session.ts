/** Session and project-tree types shared by main (the source of truth) and the renderer (the sidebar). */
import { asSessionId, UUID_RE, type PtyId, type SessionId } from './ids'

/** Metadata extracted from a session JSONL without parsing the whole file. */
export interface SessionMeta {
  sessionId: SessionId
  filePath: string
  fileMtimeMs: number
  fileSize: number
  /** Authoritative working directory, read from inside the JSONL. Never derived from the directory name. */
  cwd: string | null
  gitBranch: string | null
  title: string | null
  firstPrompt: string | null
  startedAtMs: number | null
  lastActiveAtMs: number | null
  messageCount: number | null
}

export interface ProjectInfo {
  path: string
  repoRoot: string | null
  isWorktree: boolean
  branch: string | null
  exists: boolean
}

export interface SessionNode {
  kind: 'session'
  sessionId: SessionId
  title: string
  cwd: string
  /** Branch recorded in the session's JSONL, shown in the row's tooltip. */
  gitBranch: string | null
  lastActiveAtMs: number | null
  messageCount: number | null
  isLive: boolean
  cwdExists: boolean
  /** The user's own note about this session; null when there is none. Searched alongside titles and transcripts. */
  note: string | null
}

export interface ProjectNode {
  kind: 'project'
  /** Stable identity: the absolute project path. */
  path: string
  label: string
  branch: string | null
  isWorktree: boolean
  children: ProjectNode[]
  sessions: SessionNode[]
}

export interface DiscoveredSession {
  sessionId: SessionId
  projectPath: string
  title: string
  lastActiveAtMs: number | null
  imported: boolean
}

export interface ResumeConflict {
  sessionId: SessionId
  pid: number
}

/**
 * Identifies the terminal for a brand-new (non-`--resume`) session that has no session id yet.
 * `ptyId` is the `PtyManager` key the renderer's `TerminalView` binds to; `cwd` is the folder it
 * was started in, used to match it up with the real `SessionNode` once Claude writes its JSONL.
 */
export interface NewSessionInfo {
  ptyId: PtyId
  cwd: string
  label: string
}

/**
 * What a session is called when it has neither a title nor a first prompt yet (a new session, or
 * one `/clear` started), instead of a raw session id.
 */
export const UNTITLED_SESSION = 'New session'

/**
 * What a `treeChanged` says changed. `sessions: null` means unknown: every listener treats it as
 * "everything". A missing payload means the same as `null`.
 */
export interface TreeChange {
  sessions: SessionId[] | null
}

/** Whether `change` may concern `sessionId` (an unknown or missing change concerns every session). */
export function treeChangeConcerns(change: TreeChange | undefined, sessionId: SessionId): boolean {
  const sessions = change?.sessions ?? null
  return sessions === null || sessions.includes(sessionId)
}

/**
 * The sessions whose transcript files are `paths`: a session file is `<uuid>.jsonl`. Any other
 * file (a subagent's, a stray one) cannot be pinned to a session here, so the change is unknown.
 */
export function treeChangeOfPaths(paths: readonly string[]): TreeChange {
  const sessions: SessionId[] = []
  for (const p of paths) {
    const name = p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
    if (!name.endsWith('.jsonl')) return { sessions: null }
    const id = name.slice(0, -'.jsonl'.length)
    if (!UUID_RE.test(id)) return { sessions: null }
    sessions.push(asSessionId(id))
  }
  return { sessions }
}
