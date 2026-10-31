import type { PtyId } from '@shared/domain/ids'
import type { ActivityStatus } from '@shared/activity'
/** Everything a pending (not yet resolved) new session needs to render as a tab. */
export interface PendingTabInfo { ptyId: PtyId; cwd: string; label: string }

export interface SessionTabView {
  key: string
  label: string
  /** A session started from "+" that hasn't produced its JSONL yet, shown the way the sidebar
   *  shows it so the two agree while it resolves. */
  isPending: boolean
  /** What the session is doing now, from the same store the Active section reads. */
  activity: ActivityStatus
  /** The branch, else the folder's name, shown beside the title in the tab list; absent when unknown. */
  hint?: string
}
