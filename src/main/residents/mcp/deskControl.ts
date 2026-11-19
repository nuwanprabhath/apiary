import type { WorktreeCreateRequest } from '@shared/domain/git'
import type { SessionId } from '@shared/domain/ids'

/** What the session-driving tools reach. Declared here so `residents/` never imports `driving`; `desk/` implements it. */
export interface DriveControl {
  folders(): { id: string; name: string; branch: string | null; isRepo: boolean; worktreeOf: string | null }[]
  /** `task` makes the session watched for that task. */
  send(sessionId: SessionId, text: string, task: string | null): Promise<'sent' | 'waiting'>
  start(folderId: string, text: string, worktree: WorktreeCreateRequest | null, task: string | null): Promise<{ sessionId: SessionId; folderName: string }>
  interrupt(sessionId: SessionId): void
  watch(sessionId: SessionId, task: string | null): void
  unwatch(sessionId: SessionId): void
  /** One line per watched session: title, id, status, since, task. */
  watching(): string[]
}

/** What the Slack tools reach. Declared here so `residents/` never imports `slack`; `desk/` implements it. */
export interface SlackControl {
  /** Posts to the task's thread (Markdown in). Throws for an unknown or finished task. */
  post(task: string, text: string): Promise<void>
  /** Posts the summary, then marks the task done: its sessions are unwatched and its `allow all` ends. */
  finish(task: string, summary: string): Promise<void>
  /** One line per open task: id, first 80 characters of its text, its sessions. */
  openTasks(): string[]
  /** The resident works for the task: its turns and permission requests belong to it. */
  addResident(task: string, residentId: string): void
}

export interface DeskControls {
  drive: DriveControl
  slack: SlackControl
}
