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
  lastActiveAtMs: number | null
  messageCount: number | null
  isLive: boolean
  cwdExists: boolean
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
