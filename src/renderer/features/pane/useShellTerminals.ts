import { useCallback, useEffect, useRef, useState } from 'react'
import { shellPtyId } from '@shared/domain/ptyId'
import type { PtyId, TerminalRef } from '@shared/domain/ids'
import { moveBefore } from '../sidebar/model/groups'
import { useNotifications } from '../../ui/notifications'
import { useShellSetters, type TerminalTab } from '../workspace'
import type { PaneWorkspace } from './usePaneWorkspace'
import { killPty, runningPtys, spawnShell } from '../../state/terminals'
import { logLine } from '../../state/log'

export interface ShellTerminals {
  shellOpen: boolean
  tabListOpen: boolean
  setTabListOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  /** F2 in a shell: which terminal to rename. See TerminalListPanel's `renameRequest`. */
  renameRequest: { id: string } | null
  setRenameRequest: (request: { id: string } | null) => void
  /** Bumped per terminal whose process was started again, so its view remounts and attaches the
   *  way a fresh terminal's does — snapshot, fit, resize — rather than staying on the dead pty's
   *  blank screen at the default 80x24. */
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
 * One pane's shell terminals: the open/closed state of its shell card, and the terminals listed
 * under the session in front. The lists themselves live in the workspace (`shellTabs`,
 * `activeTerminal`), filed under `keyFor(tab)`, so two panes showing the same split session share
 * one set; this reads this pane's entries (`workspace`) and writes through the workspace rather than
 * taking setters as props.
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

  // Guards `ensureShellFor` against firing twice for the same key before its first spawn has
  // committed to `shellTabs` — a ref (not state) because the check must be synchronous, and
  // because two columns showing the *same* split session share one `shellTabs` entry, so a
  // second column's own render could otherwise race a spawn already in flight from the first.
  const spawningRef = useRef<Set<string>>(new Set())

  /**
   * Spawns a first terminal for `key` if it has none *live*. Shared by the "Show shell" button
   * and the auto-open effect below, so a session that already has a shell never gets a second
   * spawned out from under it, and a session whose shell was exited (`exit` at the prompt, its
   * dead tab pruned by App's pty-exit handler) reliably gets a fresh one either way.
   */
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

  const [revivals, setRevivals] = useState<Map<string, number>>(() => new Map())
  const revivingRef = useRef<Set<string>>(new Set())

  /**
   * Starts a listed terminal again when it comes on screen with no process behind it.
   *
   * Shells end with the app, but the restored layout still lists them — and "Show shell" only
   * spawns for a session with *no* terminal listed, so after a relaunch it found the listing,
   * spawned nothing, and showed a pty that no longer existed: a blinking cursor with no prompt,
   * which hiding and showing again could not fix, while "+" (a new id) worked. The terminal is
   * restarted under its own id and name, so the list the user arranged stays as it was.
   */
  const shownShellPty = shellOpen && isActive && shellKey !== null && currentTerminalId !== null
    ? shellPtyId(shellKey, currentTerminalId) : null
  useEffect(() => {
    if (shownShellPty === null || currentTerminalId === null) return
    if (revivingRef.current.has(shownShellPty)) return
    let cancelled = false
    const ptyId = shownShellPty
    const terminalId = currentTerminalId
    void runningPtys([ptyId]).then(async (running) => {
      // Not knowing is not a reason to start a second process over a live id.
      if (cancelled || running === null || running.includes(ptyId)) return
      revivingRef.current.add(ptyId)
      logLine('info', 'shell', 'restarting a listed terminal with no process', { ptyId })
      try {
        await spawnTerminal(terminalId)
        setRevivals((prev) => new Map(prev).set(ptyId, (prev.get(ptyId) ?? 0) + 1))
      } catch (e: unknown) {
        notifyError(e, 'Could not restart the shell')
      } finally {
        revivingRef.current.delete(ptyId)
      }
    })
    return () => { cancelled = true }
  }, [shownShellPty, currentTerminalId, spawnTerminal, notifyError])

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

  /**
   * Auto-opens a shell for a tab that switches into view while the pane is already open but that
   * tab itself has never had one. `shellOpen` lives at the column level, not per tab — switching
   * to a session you have never shown the shell for used to leave the pane rendering nothing at
   * all (no terminal exists for that key yet, and nothing spawns one without a click), which read
   * as "Show shell did nothing" even though the pane genuinely was open. See
   * sessionTabs.spec.ts's "switching to a tab that never had a shell open" for the regression.
   *
   * Restricted to the focused column: two columns can show the same split session and would
   * otherwise both race to spawn its first terminal the moment either one opens its shell.
   */
  useEffect(() => {
    if (!isActive || !shellOpen || shellKey === null) return
    if ((shellTabs.get(shellKey) ?? []).length > 0) return
    void ensureShellFor(shellKey).catch((e: unknown) => { notifyError(e, 'Could not open a shell') })
  }, [isActive, shellOpen, shellKey, shellTabs, ensureShellFor, notifyError])

  const addTerminalTab = useCallback(async () => {
    if (shellKey === null) return
    const existing = shellTabs.get(shellKey) ?? []
    // Ids climb forever within a session rather than reusing a freed number, so a just-deleted
    // tab's pty id can never collide with a new one's; the name follows the id for the same reason.
    const maxId = existing.reduce((m, t) => Math.max(m, Number(t.id)), 0)
    const newId = String(maxId + 1)
    try {
      await spawnTerminal(newId)
      setShellTabs((prev) => new Map(prev).set(shellKey, [...existing, { id: newId, name: `Terminal ${newId}` }]))
      setActiveTerminal((prev) => new Map(prev).set(shellKey, newId))
      setShellOpen(true)
      // Reveal the list too: a new terminal is otherwise indistinguishable from the one already on
      // screen, so the click reads as having done nothing at all.
      setTabListOpen(true)
    } catch (e) {
      notifyError(e, 'Could not open a new terminal')
    }
  }, [shellKey, shellTabs, spawnTerminal, setShellTabs, setActiveTerminal, notifyError])

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
  }, [shellKey, shellTabs, setShellTabs, setActiveTerminal])

  return {
    shellOpen, tabListOpen, setTabListOpen, renameRequest, setRenameRequest, revivals, terminalsFor,
    activeTerminalFor, currentTerminals, currentTerminalId, toggleShell, addTerminalTab, renameTerminalTab,
    reorderTerminalTab, switchTerminalTab, deleteTerminalTab,
  }
}
