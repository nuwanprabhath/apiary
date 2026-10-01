import type { PtyId } from '@shared/domain/ids'
/** Everything a pending (not yet resolved) new session needs to render as a tab. */
export interface PendingTabInfo { ptyId: PtyId; cwd: string; label: string }
