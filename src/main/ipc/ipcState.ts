import type { ClaudeSessionTracker } from '../claude/claudeSessionTracker'
import type { ActivityBroadcaster } from '../terminals/activityBroadcaster'
import type { PtyDataCoalescer } from '../terminals/ptyDataCoalescer'
import type { TabMover } from '../windows/tabMover'
import type { WindowAttachments } from '../windows/windowAttachments'

/**
 * The stateful objects the IPC handlers share between channels. Built in the container
 * (`createIpcState`), so every long-lived object has one construction site; the handlers wire them
 * to events (`pty.onData`, `app.on('browser-window-focus')`), start the tracker and stop it again.
 */
export interface IpcState {
  /** Which session each Claude terminal is on, followed through /clear, /resume and /rename. */
  sessionTracker: ClaudeSessionTracker
  /** Which windows show which pty: `ptyData` goes only to those. */
  ptyAttachments: WindowAttachments
  /** Folds a burst of pty output into one message per window per frame. */
  ptyCoalescer: PtyDataCoalescer
  /** Coalesces pty activity into the Active section's broadcasts. */
  activity: ActivityBroadcaster
  /** Cross-window tab moves. */
  tabMover: TabMover
}
