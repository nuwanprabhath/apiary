/** Session and project-tree types shared by main (the source of truth) and the renderer (the sidebar). */

/** Metadata extracted from a session JSONL without parsing the whole file. */
export interface SessionMeta {
  sessionId: string
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
  sessionId: string
  title: string
  cwd: string
  /** Branch recorded in the session's JSONL, shown in the row's tooltip. */
  gitBranch: string | null
  lastActiveAtMs: number | null
  messageCount: number | null
  isLive: boolean
  cwdExists: boolean
  /**
   * The user's own note about this session — what they were doing, the ticket or MR it belongs to.
   * Null when there is none, which is the normal case; shown in the row's hover card and searched
   * alongside titles and transcripts.
   */
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
  sessionId: string
  projectPath: string
  title: string
  lastActiveAtMs: number | null
  imported: boolean
}

export interface ResumeConflict {
  sessionId: string
  pid: number
}

/**
 * Identifies the terminal for a brand-new (non-`--resume`) session that has no session id yet.
 * `ptyId` is the `PtyManager` key the renderer's `TerminalView` binds to; `cwd` is the folder it
 * was started in, used to match it up with the real `SessionNode` once Claude writes its JSONL.
 */
export interface NewSessionInfo {
  ptyId: string
  cwd: string
  label: string
}

/**
 * What a session is called when it has neither a title nor a first prompt yet — which is a session
 * nobody has typed in: `/clear` starts one, and a new session is one until its first message.
 * It used to fall back to the raw session id, so the header and Active showed
 * `d81148ef-1230-4160-…` for exactly the session the user had just started.
 */
export const UNTITLED_SESSION = 'New session'
