import { BrowserWindow, webContents } from 'electron'
import { type PtyManager } from '../pty/ptyManager'
import { ClaudeSessionTracker } from '../claude/claudeSessionTracker'
import { rememberAccounts, trackedProcesses, type TrackerAccounts } from '../claude/trackerAccounts'
import { PtyDataCoalescer } from '../terminals/ptyDataCoalescer'
import { ActivityBroadcaster } from '../terminals/activityBroadcaster'
import { TabMover } from '../windows/tabMover'
import type { IpcState } from '../ipc/ipcState'
import type { TabTransfer } from '@shared/types'
import { type TabRegistry } from '../windows/tabRegistry'
import { broadcast } from '../windows/broadcast'
import { WindowAttachments } from '../windows/windowAttachments'
import type { VirtualContentsRegistry } from '../remote/virtualContents'
import { IPC } from '@shared/api'

const ACTIVITY_BROADCAST_MS = 500

export interface IpcStateInputs {
  pty: PtyManager
  configRoot: string
  tabRegistry: TabRegistry | null
  /** Opens a tab in a window of its own, resolving the new window's number. */
  openDetachedWindow: (tab: TabTransfer, at: { x: number; y: number }) => number
  windowNumberFor: (webContentsId: number) => number | null
  /** Remote windows, which `ptyData` reaches once they attach; none when omitted. */
  virtualContents?: VirtualContentsRegistry
  /** Where each account's pid files are, and where a resolved session's account is recorded. */
  accounts: TrackerAccounts
}

export function createIpcState(inputs: IpcStateInputs): IpcState {
  const ptyAttachments = new WindowAttachments((wcId) => webContents.fromId(wcId) ?? inputs.virtualContents?.get(wcId) ?? null)
  return {
    sessionTracker: new ClaudeSessionTracker({
      // Each `claude` writes its pid file under its own account's config folder.
      processes: () => trackedProcesses(inputs.pty, inputs.configRoot, inputs.accounts),
      onChange: (sessions) => {
        rememberAccounts(sessions, inputs.pty, inputs.accounts)
        broadcast(IPC.ptySessionsChanged, sessions)
        broadcast(IPC.activeTabsChanged)
      },
    }),
    ptyAttachments,
    ptyCoalescer: new PtyDataCoalescer({
      onFlush: (id, data) => { ptyAttachments.sendTo(id, IPC.ptyData, id, data) },
    }),
    activity: new ActivityBroadcaster({
      onBroadcast: () => { broadcast(IPC.activeTabsChanged) },
      intervalMs: ACTIVITY_BROADCAST_MS,
    }),
    tabMover: new TabMover({
      getWindows: () => BrowserWindow.getAllWindows(),
      tabRegistry: inputs.tabRegistry,
      pty: inputs.pty,
      openDetachedWindow: inputs.openDetachedWindow,
      windowNumberFor: inputs.windowNumberFor,
    }),
  }
}
