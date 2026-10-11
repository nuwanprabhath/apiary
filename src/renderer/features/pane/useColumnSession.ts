import { useMemo } from 'react'
import { terminalRef, type TerminalRef } from '@shared/domain/ids'
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

  const tabViews: SessionTabView[] = column.tabs.map((tab) => {
    const p = pending.get(tab.key)
    if (p !== undefined) return { key: tab.key, label: p.label, isPending: true }
    return { key: tab.key, label: sessions.get(tab.key)?.title ?? tab.key, isPending: false }
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
