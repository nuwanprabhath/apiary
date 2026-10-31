import { lastPathSegment } from '@shared/text'
import { useMemo } from 'react'
import { strongestActivity, type ActivityStatus } from '@shared/activity'
import { terminalRef, type TerminalRef } from '@shared/domain/ids'
import { useActiveTabs } from '../../state/activeTabsStore'
import type { Column, OpenTab } from '../../state/columns'
import { findTab } from '../../state/columns'
import type { SessionTabView } from './paneTypes'
import { usePaneWorkspace } from './usePaneWorkspace'
import { useSessionKeys } from './useSessionKeys'

/**
 * What one column shows: the sessions, pending sessions and live processes behind its tabs (read
 * from the workspace by the pane itself, so a change to another pane's does not render this one),
 * the active tab and how each tab is viewed, and the terminal ref its shell, git and plugins hang off.
 */
export function useColumnSession(column: Column) {
  const workspace = usePaneWorkspace(useMemo(() => column.tabs.map((t) => t.key), [column.tabs]))
  const { sessions, pending, resumed } = workspace

  const activeKey = column.activeKey
  const activeTab = activeKey !== null ? findTab(column, activeKey) : null
  const activeSession = activeKey !== null ? sessions.get(activeKey) ?? null : null
  const activePending = activeKey !== null ? pending.get(activeKey) ?? null : null

  const { keyFor, isPtyKey } = useSessionKeys(workspace)
  const shellKey = activeKey !== null ? keyFor(activeKey) : null
  const shellKeyIsPtyId = activeKey !== null && isPtyKey(activeKey)
  // One ref for every cwd-carrying call, so the key and which kind it is cannot be separated.
  const terminal: TerminalRef | null = useMemo(
    () => (shellKey === null ? null : terminalRef(shellKey, shellKeyIsPtyId)),
    [shellKey, shellKeyIsPtyId],
  )

  const activeTabs = useActiveTabs()
  /** A session open in several windows is working if any of them says so, then waiting. */
  const activityOf = (key: string): ActivityStatus => {
    return strongestActivity(activeTabs.filter((t) => t.key === key).map((t) => t.status)) ?? 'idle'
  }
  const tabViews: SessionTabView[] = column.tabs.map((tab) => {
    const p = pending.get(tab.key)
    const activity = activityOf(tab.key)
    if (p !== undefined) return { key: tab.key, label: p.label, isPending: true, activity, hint: folderName(p.cwd) }
    const s = sessions.get(tab.key)
    return { key: tab.key, label: s?.title ?? tab.key, isPending: false, activity, hint: s?.gitBranch ?? folderName(s?.cwd ?? null) }
  })

  /** A pending session has no transcript to show, so its tab is always the live terminal. */
  const viewOf = (tab: OpenTab): OpenTab['view'] => (pending.has(tab.key) ? 'terminal' : tab.view)
  const showTerminalFor = (tab: OpenTab): boolean =>
    pending.has(tab.key) || resumed.has(tab.key)
  const activeView = activeTab !== null ? viewOf(activeTab) : 'transcript'

  return {
    workspace, resumed, activeKey, activeSession, activePending, keyFor, shellKey, terminal,
    tabViews, viewOf, showTerminalFor, activeView,
  }
}

/** The last segment of a folder path, or undefined when there is none. */
function folderName(cwd: string | null): string | undefined {
  const name = cwd === null ? '' : lastPathSegment(cwd)
  return name === '' ? undefined : name
}
