/**
 * A barrel: these types used to be defined directly here, split by topic into `shared/domain/*`
 * now (SHARED-1). Re-exported under the same names so existing `from '@shared/types'` imports are
 * unaffected — the split changed where things live, not what anything is called.
 */
export type { SessionMeta, ProjectInfo, SessionNode, ProjectNode } from './domain/session'
export { UNTITLED_SESSION } from './domain/session'
export type { GitStatus, GitRefEntry, GitRefs, FolderWorktree, WorktreeConflict, CheckoutOutcome } from './domain/git'
export type { TranscriptBlock, TranscriptMessage, TranscriptPage } from './domain/transcript'
export { TRANSCRIPT_PAGE_SIZE } from './domain/transcript'
export type { ResumeConflict, NewSessionInfo } from './domain/session'
export type {
  TabTransfer, PersistedTab, PersistedPane, PersistedLayout, WindowLayoutReport,
} from './domain/tabs'
export { isTabTransfer, isWindowLayoutReport } from './domain/tabs'
