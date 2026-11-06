import { useCallback } from 'react'
import type { SessionNode } from '@shared/types'
import type { DialogRequest } from '../features/dialogs/useDialogs'
import { useWindowTitle } from './useWindowTitle'

/**
 * What a pane needs besides tab-key handlers: the settings opener (stable) and `titleOf`, which
 * changes with `openSessions` on purpose, so a tab's title follows its session. The window is named
 * after its active tab (`activeKey`) on the way.
 */
export function useTabTitleAndSettings(
  openSessions: ReadonlyMap<string, SessionNode>,
  pendingTabInfo: ReadonlyMap<string, { label: string }>,
  openDialog: (request: DialogRequest) => void,
  activeKey: string | null,
): { onOpenSettings: (section: string) => void; titleOf: (key: string) => string | null } {
  const onOpenSettings = useCallback((section: string) => { openDialog({ kind: 'settings', section }) }, [openDialog])
  const titleOf = useCallback(
    (key: string) => openSessions.get(key)?.title ?? pendingTabInfo.get(key)?.label ?? null,
    [openSessions, pendingTabInfo],
  )
  useWindowTitle(activeKey === null ? null : titleOf(activeKey))
  return { onOpenSettings, titleOf }
}
