import { useCallback } from 'react'
import { shellPtyId } from '@shared/domain/ptyId'
import { moveBefore } from '../../state/groups'
import { useShellSetters, type TerminalTab } from '../workspace'
import { killPty } from '../../state/terminals'

/** Renaming, reordering, switching and deleting the terminals listed under one session. */
export function useShellTabEdits(
  shellKey: string | null,
  shellTabs: ReadonlyMap<string, TerminalTab[]>,
  setShellOpen: (open: boolean) => void,
) {
  const { setShellTabs, setActiveTerminal } = useShellSetters()

  const renameTerminalTab = useCallback((tabId: string, name: string) => {
    if (shellKey === null) return
    setShellTabs((prev) => {
      const list = prev.get(shellKey) ?? []
      return new Map(prev).set(shellKey, list.map((t) => (t.id === tabId ? { ...t, name } : t)))
    })
  }, [shellKey, setShellTabs])

  /** Drag-to-reorder within the terminal list, matching the tab strip and the sidebar. */
  const reorderTerminalTab = useCallback((tabId: string, beforeId: string) => {
    if (shellKey === null) return
    setShellTabs((prev) => {
      const list = prev.get(shellKey) ?? []
      const order = moveBefore(list.map((t) => t.id), tabId, beforeId)
      const byId = new Map(list.map((t) => [t.id, t]))
      const next = order.map((id) => byId.get(id)).filter((t): t is TerminalTab => t !== undefined)
      return new Map(prev).set(shellKey, next)
    })
  }, [shellKey, setShellTabs])

  const switchTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    setActiveTerminal((prev) => new Map(prev).set(shellKey, tabId))
  }, [shellKey, setActiveTerminal])

  const deleteTerminalTab = useCallback((tabId: string) => {
    if (shellKey === null) return
    killPty(shellPtyId(shellKey, tabId))
    const list = (shellTabs.get(shellKey) ?? []).filter((t) => t.id !== tabId)
    setShellTabs((prev) => {
      const next = new Map(prev)
      if (list.length === 0) next.delete(shellKey)
      else next.set(shellKey, list)
      return next
    })
    setActiveTerminal((prev) => {
      if (prev.get(shellKey) !== tabId) return prev
      const next = new Map(prev)
      if (list.length === 0) next.delete(shellKey)
      else next.set(shellKey, list[0].id)
      return next
    })
    if (list.length === 0) setShellOpen(false)
  }, [shellKey, shellTabs, setShellTabs, setActiveTerminal, setShellOpen])

  return { renameTerminalTab, reorderTerminalTab, switchTerminalTab, deleteTerminalTab }
}
