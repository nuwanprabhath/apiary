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

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
}

/** One row in the branch switcher's branch/remote/tag lists. */
export interface GitRefEntry {
  name: string
  relativeDate: string
  author: string
  shortSha: string
  subject: string
}

export interface GitRefs {
  current: string | null
  local: GitRefEntry[]
  remote: GitRefEntry[]
  tags: GitRefEntry[]
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

export type TreeNode = ProjectNode | SessionNode

export type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  /** An image recorded in the session itself, carried as a data URL ready to render. */
  | { type: 'image'; dataUrl: string }

export interface TranscriptMessage {
  uuid: string
  role: 'user' | 'assistant'
  timestampMs: number | null
  isSidechain: boolean
  blocks: TranscriptBlock[]
}

export interface TranscriptPage {
  messages: TranscriptMessage[]
  /** Byte offset to continue reading backwards from, or null when at the start. */
  earlierCursor: number | null
  skippedLines: number
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
 * A checkout refused because the branch is already checked out in another worktree.
 *
 * Reported rather than thrown, because it is not really a failure — the branch *is* available,
 * just somewhere else, and the two things anyone actually wants at that moment (bring it up to
 * date where it lives, or go and work in it) are both doable from here. Being told "fatal: …
 * already used by worktree at …" and left to go and find that directory by hand is the part
 * this replaces.
 */
export interface WorktreeConflict {
  branch: string
  /** Absolute path of the worktree holding it — resolved in the main process, shown for context. */
  worktreePath: string
  /** Its last path segment, which is what the folder is called in the sidebar. */
  label: string
}

/** What a branch checkout did. A worktree conflict is an outcome, not an error. */
export type CheckoutOutcome =
  | { ok: true }
  | { ok: false; conflict: WorktreeConflict }

/**
 * A session tab on its way from one window to another.
 *
 * The key alone is not enough to carry a *running* session across. A session started or forked
 * here runs under a `new:<uuid>` pty id that only the window which started it knows belongs to
 * the session, and its bottom shells hang off that same id — so a window handed the bare session
 * id finds no process behind it and shows the session as stopped, while the process runs on with
 * nothing showing it. Everything the receiving window needs to pick the same processes back up
 * travels here instead.
 */
export interface TabTransfer {
  key: string
  view: 'transcript' | 'terminal'
  /** The pty the session runs under, when that is not the key itself. */
  ptyId: string | null
  /** The bottom shell tabs, in order, and which one was in front. */
  shells: { id: string; name: string }[]
  activeShell: string | null
}

/** Whether something that came over IPC or out of a URL is a well-formed `TabTransfer`. */
export function isTabTransfer(value: unknown): value is TabTransfer {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && v.key !== ''
    && (v.view === 'transcript' || v.view === 'terminal')
    && (v.ptyId === null || typeof v.ptyId === 'string')
    && Array.isArray(v.shells)
    && v.shells.every((s: unknown) => typeof s === 'object' && s !== null
      && typeof (s as Record<string, unknown>).id === 'string'
      && typeof (s as Record<string, unknown>).name === 'string')
    && (v.activeShell === null || typeof v.activeShell === 'string')
}
