/**
 * A barrel: the types are defined by topic in `shared/domain/*` and re-exported here.
 */
export type { SessionMeta, ProjectInfo, SessionNode, ProjectNode } from './domain/session'
export { UNTITLED_SESSION } from './domain/session'
export type { GitStatus, GitRefEntry, GitRefs, FolderWorktree, WorktreeConflict, CheckoutOutcome } from './domain/git'
export type { TranscriptBlock, TranscriptMessage, TranscriptPage } from './domain/transcript'
export { TRANSCRIPT_PAGE_SIZE } from './domain/transcript'
export type { ResumeConflict, NewSessionInfo } from './domain/session'
export type {
  TabTransfer, PersistedLayout, WindowLayoutReport,
} from './domain/tabs'
export { isTabTransfer, isWindowLayoutReport } from './domain/tabs'
