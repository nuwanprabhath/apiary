import type { PtyId } from '@shared/domain/ids'
/** Everything a pending (not yet resolved) new session needs to render as a tab. */
export interface PendingTabInfo { ptyId: PtyId; cwd: string; label: string }

export interface SessionTabView {
  key: string
  label: string
  /** A session started from "+" that hasn't produced its JSONL yet, shown the way the sidebar
   *  shows it so the two agree while it resolves. */
  isPending: boolean
}
