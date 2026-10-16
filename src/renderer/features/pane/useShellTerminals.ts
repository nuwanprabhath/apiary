import { useCallback, useEffect, useRef, useState } from 'react'
import { shellPtyId } from '@shared/domain/ptyId'
import type { PtyId, TerminalRef } from '@shared/domain/ids'
import { useNotifications } from '../../ui/notifications'
import { useShellSetters, type TerminalTab } from '../workspace'
import type { PaneWorkspace } from './usePaneWorkspace'
import { spawnShell } from '../../state/terminals'
import { useShellRevival } from './useShellRevival'
import { useShellTabEdits } from './useShellTabEdits'

export interface ShellTerminals {
  shellOpen: boolean
  tabListOpen: boolean
  setTabListOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  /** F2 in a shell: which terminal to rename. See TerminalListPanel's `renameRequest`. */
  renameRequest: { id: string } | null
  setRenameRequest: (request: { id: string } | null) => void
  /** Bumped per terminal whose process was started again, so its view remounts and attaches like a
   *  fresh terminal's rather than staying on the dead pty's blank 80x24 screen. */
  revivals: Map<string, number>
  terminalsFor: (tabKey: string) => TerminalTab[]
  activeTerminalFor: (tabKey: string) => string | null
  currentTerminals: TerminalTab[]
  currentTerminalId: string | null
  toggleShell: () => Promise<void>
  addTerminalTab: () => Promise<void>
  renameTerminalTab: (tabId: string, name: string) => void
  reorderTerminalTab: (tabId: string, beforeId: string) => void
  switchTerminalTab: (tabId: string) => void
  deleteTerminalTab: (tabId: string) => void
}

/**
 * One pane's shell terminals. The lists live in the workspace (`shellTabs`, `activeTerminal`) under
 * `keyFor(tab)`, so two panes showing the same split session share one set.
 */
export function useShellTerminals({ activeKey, terminal, isActive, keyFor, workspace }: {
  activeKey: string | null
  terminal: TerminalRef | null
  isActive: boolean
  keyFor: (tabKey: string) => PtyId
  /** This pane's slice of the workspace (`usePaneWorkspace`). */
  workspace: Pick<PaneWorkspace, 'shellTabs' | 'activeTerminal'>
}): ShellTerminals {
  const { notifyError } = useNotifications()
  const shellKey = terminal === null ? null : terminal.id
  const { shellTabs, activeTerminal } = workspace
  const { setShellTabs, setActiveTerminal } = useShellSetters()
  const [shellOpen, setShellOpen] = useState(false)
  const [tabListOpen, setTabListOpen] = useState(false)
  const [renameRequest, setRenameRequest] = useState<{ id: string } | null>(null)

  const terminalsFor = useCallback(
    (tabKey: string): TerminalTab[] => shellTabs.get(keyFor(tabKey)) ?? [],
    [shellTabs, keyFor],
  )
  const activeTerminalFor = useCallback(
    (tabKey: string): string | null => {
      const list = terminalsFor(tabKey)
      const wanted = activeTerminal.get(keyFor(tabKey))
      return list.find((t) => t.id === wanted)?.id ?? list[0]?.id ?? null
    },
    [terminalsFor, activeTerminal, keyFor],
  )

  const currentTerminals = activeKey !== null ? terminalsFor(activeKey) : []
  const currentTerminalId = activeKey !== null ? activeTerminalFor(activeKey) : null

  const spawnTerminal = useCallback(async (id: string): Promise<void> => {
    if (terminal === null) return
    await spawnShell(terminal, id)
  }, [terminal])

  // A ref because the check must be synchronous, and two columns showing the same split session
  // share one `shellTabs` entry, so the second could race a spawn already in flight.
  const spawningRef = useRef<Set<string>>(new Set())

  // Spawns a first terminal for `key` if it has none live; shared by "Show shell" and the auto-open effect.
  const ensureShellFor = useCallback(async (key: string): Promise<void> => {
    if ((shellTabs.get(key) ?? []).length > 0) return
    if (spawningRef.current.has(key)) return
    spawningRef.current.add(key)
    try {
      await spawnTerminal('1')
      setShellTabs((prev) => new Map(prev).set(key, [{ id: '1', name: 'Terminal 1' }]))
      setActiveTerminal((prev) => new Map(prev).set(key, '1'))
    } finally {
      spawningRef.current.delete(key)
    }
  }, [shellTabs, spawnTerminal, setShellTabs, setActiveTerminal])

  const shownShellPty = shellOpen && isActive && shellKey !== null && currentTerminalId !== null
    ? shellPtyId(shellKey, currentTerminalId) : null
  const revivals = useShellRevival(shownShellPty, currentTerminalId, spawnTerminal)
  const { renameTerminalTab, reorderTerminalTab, switchTerminalTab, deleteTerminalTab } =
    useShellTabEdits(shellKey, shellTabs, setShellOpen)

  const toggleShell = useCallback(async () => {
    if (shellKey === null) return
    if (shellOpen) { setShellOpen(false); return }
    try {
      await ensureShellFor(shellKey)
    } catch (e) {
      notifyError(e, 'Could not open a shell')
      return
    }
    setShellOpen(true)
  }, [shellKey, shellOpen, ensureShellFor, notifyError])

  // Auto-opens a shell for a tab switched into view that never had one: `shellOpen` is per column,
  // not per tab, so the pane would render nothing. Restricted to the focused column, or two columns
  // on the same split session would race to spawn its first terminal.
  useEffect(() => {
    if (!isActive || !shellOpen || shellKey === null) return
    if ((shellTabs.get(shellKey) ?? []).length > 0) return
    void ensureShellFor(shellKey).catch((e: unknown) => { notifyError(e, 'Could not open a shell') })
  }, [isActive, shellOpen, shellKey, shellTabs, ensureShellFor, notifyError])

  const addTerminalTab = useCallback(async () => {
    if (shellKey === null) return
    const existing = shellTabs.get(shellKey) ?? []
    // Ids are never reused, so a just-deleted tab's pty id cannot collide with a new one's.
    const maxId = existing.reduce((m, t) => Math.max(m, Number(t.id)), 0)
    const newId = String(maxId + 1)
    try {
      await spawnTerminal(newId)
      setShellTabs((prev) => new Map(prev).set(shellKey, [...existing, { id: newId, name: `Terminal ${newId}` }]))
      setActiveTerminal((prev) => new Map(prev).set(shellKey, newId))
      setShellOpen(true)
      // A new terminal looks identical to the one on screen unless the list is revealed.
      setTabListOpen(true)
    } catch (e) {
      notifyError(e, 'Could not open a new terminal')
    }
  }, [shellKey, shellTabs, spawnTerminal, setShellTabs, setActiveTerminal, notifyError])


  return {
    shellOpen, tabListOpen, setTabListOpen, renameRequest, setRenameRequest, revivals, terminalsFor,
    activeTerminalFor, currentTerminals, currentTerminalId, toggleShell, addTerminalTab, renameTerminalTab,
    reorderTerminalTab, switchTerminalTab, deleteTerminalTab,
  }
}
