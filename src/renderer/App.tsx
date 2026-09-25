import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isTabTransfer,
  type NewSessionInfo, type ProjectNode, type ResumeConflict, type SessionNode, type TabTransfer,
  type WindowLayoutReport,
} from '@shared/types'
import { buildPersistedLayout } from '@shared/layoutReport'
import { Sidebar } from './components/Sidebar'
import { SessionColumn, type TerminalTab } from './components/SessionColumn'
import { ConflictDialog } from './components/ConflictDialog'
import { DeleteSessionDialog } from './components/DeleteSessionDialog'
import { MoveSessionDialog } from './components/MoveSessionDialog'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import {
  openTab, openTabAfter, closeTab, setTabView, rekeyTab, moveTabToColumn, adoptTab,
  findColumnWithTab, newColumn,
  type Column,
} from './state/columns'
import {
  initialLayout, tidyLayout, openBeside, defaultTracks, trackTemplate, placeInZone, applyPreset,
  presetDef, closePane, PRESETS,
  type Layout, type PresetId, type Tracks,
} from './state/layout'
import { LayoutContext, type LayoutActions, type PlaceTarget } from './state/layoutContext'
import { LayoutPicker } from './components/LayoutPicker'
import { LayoutMenuButton } from './components/LayoutMenuButton'
import { PaneDividers } from './components/PaneDividers'
import { PaneFiller } from './components/PaneFiller'
import {
  loadUiState, saveUiState, subscribeSharedUiState, detachedKey, detachedTransfer, restoredWindow,
  type UiState,
} from './state/uiState'
import { pruneDismissed, dismissRecent } from './state/recentSessions'
import { useThemeState, useAppliedTheme } from './theme/useTheme'
import { ThemeEffects } from './theme/ThemeEffects'
import { useUpdate } from './state/useUpdate'
import { usePtySessions } from './state/usePtySessions'
import { useActiveTabs } from './state/useActiveTabs'
import { UpdateBanner } from './components/UpdateBanner'
import { NoteDialog } from './components/NoteDialog'
import { moveBefore, type GroupState } from './state/groups'
import { useNotifications } from './state/notifications'
import { ErrorBoundary } from './components/ErrorBoundary'
import { describeError } from './errors'
import { SidebarIcon, LayoutIcon } from './components/icons'

/** How the toggle's shortcut is written on this platform — see the View menu in main/menu.ts. */
const SIDEBAR_SHORTCUT = navigator.platform.toLowerCase().includes('mac') ? '⌘B' : 'Ctrl+Shift+B'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 600

// Floor keeps the toolbar plus a few rows of terminal usable; ceiling leaves the transcript
// area above it readable rather than squeezed to a sliver.
const MIN_BOTTOM_HEIGHT = 120
const MAX_BOTTOM_HEIGHT = 560

function findSessionById(nodes: ProjectNode[], id: string): SessionNode | null {
  for (const node of nodes) {
    const hit = node.sessions.find((s) => s.sessionId === id)
    if (hit) return hit
    const inChild = findSessionById(node.children, id)
    if (inChild) return inChild
  }
  return null
}

/** Collects every session id present in the tree, so a freshly discovered session can be told
 *  apart from one that was already there before a new-session request was made. */
function collectSessionIds(nodes: ProjectNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: ProjectNode[]): void => {
    for (const node of list) {
      for (const s of node.sessions) ids.add(s.sessionId)
      walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

/**
 * Finds a session by working directory among ids not present in `excludeIds` — used to spot the
 * one session the watcher just discovered in a folder a "new session" request was made against,
 * without mistaking an already-existing session in that same (possibly non-empty) folder for it.
 */
/** Every session in the tree by id, at any depth. */
function flattenTree(nodes: ProjectNode[], into = new Map<string, SessionNode>()): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flattenTree(node.children, into)
  }
  return into
}

function findNewSessionByCwd(
  nodes: ProjectNode[],
  cwd: string,
  excludeIds: Set<string>,
): SessionNode | null {
  for (const node of nodes) {
    const hit = node.sessions.find((s) => s.cwd === cwd && !excludeIds.has(s.sessionId))
    if (hit) return hit
    const inChild = findNewSessionByCwd(node.children, cwd, excludeIds)
    if (inChild) return inChild
  }
  return null
}

/** A brand-new session's terminal, keyed by pty id until the watcher discovers its real session
 *  id. Kept in a Map (see `pending` state below) rather than a single value, so starting a second
 *  new session before the first has resolved never overwrites — and thereby orphans — the first. */
interface PendingSession extends NewSessionInfo {
  knownSessionIds: Set<string>
  /** A rename typed in before the session had a real id yet — held here since there is no
   *  session row to persist it against until reconciliation, then applied via `renameSession`
   *  the moment the real `SessionNode` is found (see the reconciliation effect below). */
  titleOverride: string | null
}


export function App(): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const [ui, setUi] = useState<UiState>(() => loadUiState())
  /** The theme, applied by the hook itself; kept here for the effects layer. */
  const theme = useThemeState()
  /** What is on screen — a preview included — for the effects layer. */
  const applied = useAppliedTheme()
  // Assumed until main answers (a moment after start-up); only effects' frame rate depends on it.
  const [gpuCompositing, setGpuCompositing] = useState(true)
  useEffect(() => { void window.apiary.themeGpuCompositing().then(setGpuCompositing) }, [])
  const updateStatus = useUpdate()
  const activeTabs = useActiveTabs()
  /** The session whose note is being edited, with the note as it stood when the editor opened. */
  const [noteTarget, setNoteTarget] = useState<{ session: SessionNode; note: string } | null>(null)
  /**
   * The tab this window was torn off to show, or null for an ordinary window. Read once: a window
   * does not stop being a detached one, and re-reading the URL per render would be a lie waiting
   * to happen.
   */
  const [detached] = useState<string | null>(detachedKey)
  /** The rest of that tab — the processes it runs, which a torn-off window has to start out knowing
   *  (see TabTransfer). Read once, like `detached`. */
  const [arrival] = useState<TabTransfer | null>(detachedTransfer)
  /**
   * The previous run's record for this window, or null for an ordinary launch — see
   * `restoredWindow`. Read once, like `detached`/`arrival`: a window does not stop being a
   * restored one mid-session, and re-reading the URL per render would be a lie waiting to happen.
   * `restoredWindow` itself already returns null for a detached window, so this and `detached`
   * are mutually exclusive.
   */
  const [restored] = useState<WindowLayoutReport | null>(restoredWindow)
  /**
   * The window's panes and which one is focused, as one piece of state rather than two.
   *
   * A gesture that both changes the layout and moves focus to a pane it just created (a split, a
   * placement from the sidebar picker) needs the new pane's id the moment it is minted — before
   * anything can read it back out. That id is only known inside the layout rule's own updater, so
   * reading it from a *second*, separately-dispatched `setActiveColumnId` update — via a variable
   * closed over by both — depended on React resolving `layout`'s pending update before
   * `activeColumnId`'s. It does not: hooks are resolved during render in the order they are
   * declared, which put `activeColumnId` first, so that second update always saw the variable's
   * unmutated initial value and focus silently fell back to pane one. Keeping both in one useState
   * means a gesture like that is one update, computed from one `prev`, with no ordering to depend
   * on. See `openSessionTab`'s split branch, `splitActiveTab` and `placeTarget`.
   */
  const [windowState, setWindowState] = useState<{ layout: Layout; activeColumnId: string | null }>(
    () => {
      if (restored === null) return { layout: initialLayout(), activeColumnId: null }
      // Panes get fresh ids from `newColumn` rather than reusing the persisted ones: `id` is a
      // per-window runtime identity, not something anything on disk needs to stay stable across a
      // restart, and reusing "col-1"/"col-2" verbatim would leave the module's own `nextColumnId`
      // counter at 0, so the very next split would mint "col-1" again and collide with a pane
      // already on screen.
      const panes = restored.layout.panes.map((pane) => ({
        ...newColumn(pane.tabs.map((t) => ({ key: t.key, view: t.view }))),
        activeKey: pane.activeTab,
      }))
      const knownPreset = PRESETS.some((p) => p.id === restored.layout.preset)
      const preset = (knownPreset ? restored.layout.preset : 'single') as PresetId
      return { layout: { preset, panes }, activeColumnId: panes[0]?.id ?? null }
    },
  )
  const { layout, activeColumnId } = windowState
  /**
   * `activePaneId`, when given, is what the tidy step keeps in front instead of the current active
   * pane — needed when the same gesture both changes the layout and moves focus to a different
   * pane: without it, tidy would decide what to do with an emptied pane using whichever pane was
   * active *before* this update, which by the time this runs is already the wrong one. It only
   * feeds the tidy step's decision; callers that also want it to become the real active pane still
   * call `setActiveColumnId` themselves (both read/write the same combined state, so there is no
   * ordering hazard between them the way there was between two separate `useState`s).
   */
  const setLayout = useCallback((update: (prev: Layout) => Layout, activePaneId?: string) => {
    setWindowState((prev) => {
      const nextLayout = tidyLayout(update(prev.layout), activePaneId ?? prev.activeColumnId)
      return nextLayout === prev.layout ? prev : { ...prev, layout: nextLayout }
    })
  }, [])
  const setActiveColumnId = useCallback((
    update: string | null | ((prev: string | null) => string | null),
  ) => {
    setWindowState((prev) => {
      const next = typeof update === 'function'
        ? (update as (p: string | null) => string | null)(prev.activeColumnId)
        : update
      return next === prev.activeColumnId ? prev : { ...prev, activeColumnId: next }
    })
  }, [])
  const columns = layout.panes
  /** The column-shaped view the existing tab operations were written against. */
  const setColumns = useCallback(
    (update: (prev: Column[]) => Column[], activePaneId?: string) => {
      setLayout((prev) => {
        const panes = update(prev.panes)
        return panes === prev.panes ? prev : { ...prev, panes }
      }, activePaneId)
    },
    [setLayout],
  )
  /** Divider positions per preset, for as long as the window is open. */
  const [tracks, setTracks] = useState<Map<PresetId, Tracks>>(new Map())
  const currentTracks = tracks.get(layout.preset) ?? defaultTracks(layout.preset)
  /**
   * The `SessionNode` behind every open tab, kept fresh from the tree so a tab's title and live
   * state track the session rather than freezing at whatever it was when it was opened. Tabs hold
   * only ids; this is where the rows themselves live.
   */
  const [openSessions, setOpenSessions] = useState<Map<string, SessionNode>>(new Map())
  const [resumed, setResumed] = useState<Set<string>>(new Set())
  // Sessions started via newSessionInProject()/newSessionInFolder() whose pty id differs from
  // the session's own id (a "new:<uuid>" id, minted before the session had one). Consulted when
  // addressing that session's terminals so the pty that was actually spawned keeps being used
  // once the real SessionNode appears, instead of a second pty being spawned under the id.
  // Also doubles as the cross-tick "already claimed" record the reconciler below consults so two
  // pending sessions in the same folder can never be folded into the same discovered SessionNode.
  const [ptyOverrides, setPtyOverrides] = useState<Map<string, string>>(() => (
    arrival?.ptyId != null ? new Map([[arrival.key, arrival.ptyId]]) : new Map()
  ))
  // Every new-session pty currently awaiting its first JSONL, keyed by pty id (not a single
  // value) so more than one can be in flight — see PendingSession above.
  const [pending, setPending] = useState<Map<string, PendingSession>>(new Map())
  /** Which Claude session each terminal is on, from Claude itself — see the effect that uses it. */
  const ptySessions = usePtySessions()
  /**
   * Shell terminals per session, keyed the way `SessionColumn` keys them. Deliberately global
   * rather than per column: two columns showing the same session must share one set of terminals,
   * or they would each spawn `shell:<key>:1` and silently kill each other's shell.
   */
  const [shellTabs, setShellTabs] = useState<Map<string, TerminalTab[]>>(() => {
    const map = new Map<string, TerminalTab[]>()
    for (const pane of restored?.layout.panes ?? []) {
      for (const tab of pane.tabs) if (tab.shells.length > 0) map.set(tab.key, tab.shells)
    }
    if (arrival !== null && arrival.shells.length > 0) map.set(arrival.ptyId ?? arrival.key, arrival.shells)
    return map
  })
  const [activeTerminal, setActiveTerminal] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>()
    for (const pane of restored?.layout.panes ?? []) {
      for (const tab of pane.tabs) if (tab.activeShell !== null) map.set(tab.key, tab.activeShell)
    }
    if (arrival?.activeShell != null) map.set(arrival.ptyId ?? arrival.key, arrival.activeShell)
    return map
  })
  const [conflict, setConflict] = useState<ResumeConflict | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionNode | null>(null)
  /** A session dropped onto a folder row, awaiting confirmation before the transcript is moved. */
  const [moveTarget, setMoveTarget] = useState<{ session: SessionNode; toPath: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  /**
   * Which settings section is on screen, or null when the dialog is closed — one piece of state
   * rather than two, so it is impossible to open the dialog without saying what it should show.
   * "Update settings" in the update banner is the reason: opening the dialog and landing on
   * Sessions makes the button look broken, since the settings it names are three clicks away.
   */
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  /**
   * Settings the renderer itself acts on. Re-read when the settings dialog closes rather than
   * subscribed to: these change only when someone changes them, and only from that one dialog.
   */
  const [revealActiveInSidebar, setRevealActiveInSidebar] = useState(true)
  const [recentSectionEnabled, setRecentSectionEnabled] = useState(true)
  const [recentSectionHours, setRecentSectionHours] = useState(24)
  const [searchChatContent, setSearchChatContent] = useState(true)
  const [searchSessionNotes, setSearchSessionNotes] = useState(true)
  const loadUiSettings = useCallback(() => {
    void window.apiary.settingsGet()
      .then((s) => {
        setRevealActiveInSidebar(s.revealActiveInSidebar)
        setRecentSectionEnabled(s.recentSectionEnabled)
        setRecentSectionHours(s.recentSectionHours)
        setSearchChatContent(s.searchChatContent)
        setSearchSessionNotes(s.searchSessionNotes)
      })
      .catch(() => {
        // Defaults are already in place; a settings read failing is not worth interrupting anyone.
      })
  }, [])
  useEffect(() => { loadUiSettings() }, [loadUiSettings])
  /**
   * Drops dismissals old enough that they could never hide a session again, so the shared map does
   * not grow without bound across months of use. Re-checked whenever the window is open and either
   * input changes; a no-op prune returns the same reference (see `pruneDismissed`), so this only
   * writes shared state when there is actually something to drop.
   */
  useEffect(() => {
    setUi((prev) => {
      const pruned = pruneDismissed(prev.dismissedRecent, Date.now(), recentSectionHours)
      return pruned === prev.dismissedRecent ? prev : { ...prev, dismissedRecent: pruned }
    })
  }, [recentSectionHours])
  /**
   * Sessions recorded as live at quit are resumed the same way a manual "Resume" click is —
   * `window.apiary.resume` already spawns `claude --resume` and is what `startResume` calls.
   * Restore is not a special code path for spawning; it is a special *reason* to call the
   * ordinary one, once, for each id the main process already pruned down to sessions that still
   * resolve (see `pruneStaleLive`/`sessionIsResumable`).
   */
  useEffect(() => {
    if (restored === null) return
    for (const sessionId of restored.live) {
      void window.apiary.resume(sessionId)
        .then(() => setResumed((prev) => new Set([...prev, sessionId])))
        .catch(() => { /* main already dropped anything unresumable; a spawn failure here is the
                         * same as a failed manual resume and needs no extra handling */ })
    }
    // Runs once: `restored` never changes after mount, and re-running on a later render would
    // re-spawn over ptys the first pass already started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [treeNonce, setTreeNonce] = useState(0)
  const [resizing, setResizing] = useState(false)
  const [resizingBottom, setResizingBottom] = useState(false)

  const activeColumn = columns.find((c) => c.id === activeColumnId) ?? columns[0]
  /** Pinned ids as a set, for the tab menu's Pin/Unpin wording. */
  const pinnedKeys = new Set(ui.pinned)
  const activeKey = activeColumn?.activeKey ?? null

  /**
   * Opens a session in the focused column, or in a brand-new column beside it when splitting.
   *
   * A session already open somewhere is focused where it is rather than opened again: the second
   * copy would be the same conversation and the same underlying process, so it reads as a split
   * that cannot be told apart from the first. Splitting is the way to ask for it twice deliberately.
   */
  const openSessionTab = useCallback((session: SessionNode, split: boolean) => {
    setOpenSessions((prev) => new Map(prev).set(session.sessionId, session))
    if (split) {
      // Computed inside one `setWindowState` updater, against `prev` rather than the render-time
      // `layout`/`activeColumnId`, so a change already queued earlier in the same tick is not
      // dropped, and so the new pane's id — only known here — reaches `activeColumnId` in the same
      // update instead of through a second, separately-ordered one.
      setWindowState((prev) => {
        const result = openBeside(prev.layout, prev.activeColumnId, { key: session.sessionId, view: 'transcript' })
        return { layout: tidyLayout(result.layout, result.paneId), activeColumnId: result.paneId }
      })
      return
    }
    setColumns((prev) => {
      const existing = findColumnWithTab(prev, session.sessionId)
      if (existing) {
        setActiveColumnId(existing.id)
        return prev.map((c) => (c.id === existing.id ? openTab(c, session.sessionId) : c))
      }
      const targetId = prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id
      return prev.map((c) => (c.id === targetId ? openTab(c, session.sessionId) : c))
    })
  }, [activeColumnId, setColumns])

  /** Closes a tab, dropping the column with it — unless it is the last one, which stays as an
   *  empty placeholder so the layout never collapses to nothing. */
  const closeSessionTab = useCallback((columnId: string, key: string) => {
    setColumns((prev) => prev.map((c) => (c.id === columnId ? closeTab(c, key) : c)))
  }, [setColumns])

  useEffect(() => { saveUiState(ui) }, [ui])
  // Pins and groups belong to the library rather than to this window, so a change made in another
  // window lands here as it happens instead of at the next launch.
  useEffect(() => subscribeSharedUiState((shared) => { setUi((prev) => ({ ...prev, ...shared })) }), [])
  useEffect(() => window.apiary.onOpenImportDialog(() => setImportOpen(true)), [])
  useEffect(() => window.apiary.onOpenSettingsDialog(() => setSettingsSection('sessions')), [])
  const toggleSidebar = useCallback(() => {
    setUi((prev) => ({ ...prev, sidebarHidden: !prev.sidebarHidden }))
  }, [])
  useEffect(() => window.apiary.onToggleSidebar(toggleSidebar), [toggleSidebar])

  // Registers a freshly-started new session as pending and opens it as a tab — shared by both
  // entry points (the sidebar "+" button and the File menu item below). The tab is keyed by pty
  // id until the watcher finds the session's real id, at which point the reconciler below rekeys
  // it in place.
  const addPending = useCallback((
    info: NewSessionInfo,
    nodes: ProjectNode[],
    // A fork arrives with both of these: a title it should keep once it has a session id to hang
    // it on, and the tab it belongs next to. A session started from scratch has neither.
    opts: { titleOverride?: string; after?: string } = {},
  ) => {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(info.ptyId, {
        ...info,
        knownSessionIds: collectSessionIds(nodes),
        titleOverride: opts.titleOverride ?? null,
      })
      return next
    })
    setColumns((prev) => {
      const after = opts.after
      const home = after === undefined ? null : findColumnWithTab(prev, after)
      // A fork opens beside its original wherever that is, even in a column the user is not
      // looking at — putting it in the active column instead would separate the two things the
      // gesture exists to compare.
      const targetId = home?.id
        ?? (prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id)
      return prev.map((c) => {
        if (c.id !== targetId) return c
        return after !== undefined && home !== null
          ? openTabAfter(c, info.ptyId, after)
          : openTab(c, info.ptyId)
      })
    })
  }, [activeColumnId])

  // `File > New Session in Folder...` picks its folder via a native dialog in the main process
  // (never from the renderer) and pushes the result here once the pty is already running.
  useEffect(() => window.apiary.onNewSessionStarted((info) => {
    void window.apiary.tree().then((nodes) => { addPending(info, nodes) })
  }), [addPending])

  // If a pending pty exits before ever producing a JSONL (the user quits Claude immediately, the
  // binary is missing, etc.) it must stop being tracked as pending rather than lingering forever
  // — nothing will ever resolve it. It is simply no longer "new" at that point: if it did somehow
  // still leave behind a JSONL, that file surfaces later as an ordinary (never-"resumed") session,
  // which is correct, since there is no longer a live process it could conflict with.
  useEffect(() => window.apiary.onPtyExit((id) => {
    setPending((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    // Only a tab still keyed by its `new:` pty id — a session whose process died before it ever
    // had a session id — is closed: there is nothing left in it to show. This used to close the tab
    // of *any* pty that exited (a 1.3.0 generalisation of what had cleared only the pending
    // session), so exiting a resumed session made its tab vanish — and with it the Active row,
    // whose "stopped" dot could therefore never be seen. A real session keeps its tab, transcript
    // and all, and reads as stopped.
    if (id.startsWith('new:')) setColumns((prev) => prev.map((c) => closeTab(c, id)))

    /**
     * A shell terminal whose process is gone must stop being listed. Typing `exit` at a shell
     * prompt kills that pty, but the tab used to stay behind pointing at it — so reopening the
     * pane showed a terminal that could never print anything again, which read as "Show shell
     * did nothing". Dropping the dead tab means the next open spawns a fresh shell instead.
     *
     * The greedy first group is deliberate: a shell key can itself contain a colon (a pending
     * session's key is `new:<uuid>`), so only the last segment is the terminal id.
     */
    const shell = /^shell:(.+):([^:]+)$/.exec(id)
    if (shell === null) return
    const [, key, terminalId] = shell
    setShellTabs((prev) => {
      const list = (prev.get(key) ?? []).filter((t) => t.id !== terminalId)
      if (list.length === (prev.get(key) ?? []).length) return prev
      const next = new Map(prev)
      if (list.length === 0) next.delete(key)
      else next.set(key, list)
      return next
    })
    setActiveTerminal((prev) => {
      if (prev.get(key) !== terminalId) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }), [])

  // Once a "new session" pty is running (either entry point), watch for the SessionNode Claude's
  // own JSONL write eventually produces. When it appears, fold the pending terminal into the
  // normal resumed-session bookkeeping — same pty id, now addressed by its real session id — so
  // there is never a second terminal spawned for the same running process.
  //
  // Every still-pending entry is reconciled independently on each tick, not just the visible one,
  // so a second "+" click (on the same folder or a different one) before the first resolves can
  // never orphan the first pty. Matching by cwd alone is ambiguous when a folder already holds —
  // or is about to hold — more than one new session, so a candidate is excluded once it is: (a) an
  // id that already existed before this particular pending entry was created (`knownSessionIds`),
  // (b) claimed by another pending entry earlier in this same pass (`claimed`), or (c) claimed by
  // any pending entry in an earlier pass (`ptyOverrides`, which accumulates for the app's lifetime
  // and is fresh here because resolving an entry changes `pending`, which re-creates this effect
  // with a closure over the latest `ptyOverrides`). That leaves exactly one irreducible case: two
  // brand-new sessions in the *same* folder whose JSONLs both appear for the very first time in
  // the very same tick. Nothing distinguishes them from cwd alone, so which pty gets labelled
  // which session id is arbitrary — but each still gets a distinct, unclaimed one, so neither pty
  // is ever orphaned and neither session ever ends up double-claimed.
  useEffect(() => {
    if (pending.size === 0) return
    let cancelled = false
    const check = (): void => {
      void window.apiary.tree().then((nodes) => {
        if (cancelled) return
        const claimed = new Set<string>()
        for (const [ptyId, info] of pending) {
          // Claude says which session this pty is on; the effect below rekeys it exactly. Guessing
          // from the folder as well could pick a different session and claim it first.
          if (ptySessions[ptyId] !== undefined) continue
          const exclude = new Set([...info.knownSessionIds, ...claimed, ...ptyOverrides.keys()])
          const found = findNewSessionByCwd(nodes, info.cwd, exclude)
          if (!found) continue
          claimed.add(found.sessionId)
          setPtyOverrides((prev) => {
            const next = new Map(prev)
            next.set(found.sessionId, ptyId)
            return next
          })
          setResumed((prev) => new Set([...prev, found.sessionId]))
          // A rename typed in while this was still pending (see PendingSession.titleOverride)
          // had nowhere to persist against until now — apply it the moment a real session id
          // exists. Applied optimistically to the SessionNode used below too, so the header
          // shows the renamed title immediately rather than flashing the scanner's own title
          // until the resulting `treeChanged` push round-trips back.
          const resolved = info.titleOverride !== null ? { ...found, title: info.titleOverride } : found
          if (info.titleOverride !== null) {
            void window.apiary.renameSession(found.sessionId, info.titleOverride).catch((e: unknown) => {
              notifyError(e, 'Could not rename the session')
            })
          }
          // Only take over the current view if the user is still looking at this pending
          // session's terminal — a user who already navigated elsewhere (or is looking at a
          // different pending session) is left alone; the bookkeeping above still ensures
          // selecting the new session later reuses this pty rather than spawning a second one.
          // The tab that was showing this pending session becomes a tab for the real session, in
          // place: same column, same position, still on the live terminal it was already watching.
          // Rekeying works wherever that tab is, including in a column the user isn't looking at,
          // so a session that resolves in the background no longer needs the "is this the visible
          // one?" bookkeeping a single-pane layout needed.
          setOpenSessions((prevOpen) => new Map(prevOpen).set(found.sessionId, resolved))
          setColumns((prevCols) => prevCols.map((c) =>
            setTabView(rekeyTab(c, ptyId, found.sessionId), found.sessionId, 'terminal'),
          ))
          setPending((prev) => {
            const next = new Map(prev)
            next.delete(ptyId)
            return next
          })
        }
      })
    }
    check()
    const off = window.apiary.onTreeChanged(check)
    return () => { cancelled = true; off() }
  }, [pending, ptyOverrides, notifyError, ptySessions])

  /**
   * Keeps every tab on the session its terminal is *actually* on, as Claude reports it.
   *
   * A tab is keyed by a session id, but the process behind it can move: a new or forked session
   * starts under a `new:<uuid>` pty id and only later has an id of its own, and `/clear` or
   * `/resume` typed in any session switch the process to another session in place. The folder
   * matching above can only guess at the first case and cannot see the others — a new session in
   * which you typed `/resume` switched to a session that already existed, which that matching
   * deliberately excludes, so the tab stayed `new:<uuid>` for good: unpinnable, absent from
   * Recent, showing its pty id in Active, and unforkable.
   *
   * `ptySessions` is Claude's own answer (`~/.claude/sessions/<pid>.json`), so no matching is
   * needed: a tab whose pty is on another session that the tree knows is rekeyed to it, carrying
   * its pty, its shells and any rename typed while it was pending. It works in any window,
   * including one a tab was moved into while still pending, which never had a pending entry for
   * it at all. A session with no JSONL yet (nothing has been typed in it) is not in the tree, so
   * the tab simply waits — never guesses.
   */
  /** Waits already logged by the effect below, so each is logged once rather than per tree change. */
  const loggedWaitsRef = useRef(new Set<string>())
  useEffect(() => {
    if (Object.keys(ptySessions).length === 0) return
    let cancelled = false
    // Re-checked on every tree change, not only when `ptySessions` changes. Claude writes its
    // session file at startup but the session's JSONL only on the first message, so the first
    // check finds nothing in the tree and `ptySessions` never changes again to prompt another.
    // Missed by a stand-in whose session already existed; caught by the live Haiku spec.
    const check = (): void => { void window.apiary.tree().then((nodes) => {
      if (cancelled) return
      const known = flattenTree(nodes)
      const openKeys = new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))
      const moves: Array<{ from: string; to: SessionNode; ptyId: string }> = []
      for (const key of openKeys) {
        const ptyId = ptyOverrides.get(key) ?? key
        const now = ptySessions[ptyId]?.sessionId
        if (now === undefined || now === key) continue
        const target = known.get(now)
        // Not in the tree yet (no message sent in it), or already open in its own tab here —
        // rekeying onto an open tab would leave two tabs claiming one key.
        if (target === undefined || openKeys.has(now)) {
          // Logged once per wait: "Active still shows new:…" was unanswerable from the log, which
          // showed the terminal on a session and then nothing. This says why it did not follow.
          const waitKey = `${key}>${now}`
          if (!loggedWaitsRef.current.has(waitKey)) {
            loggedWaitsRef.current.add(waitKey)
            window.apiary.logWrite('info', 'tabs', 'tab not following its terminal yet', {
              key, ptyId, session: now,
              reason: target === undefined ? 'no transcript yet' : 'session already open in another tab',
            })
          }
          continue
        }
        moves.push({ from: key, to: target, ptyId })
      }
      if (moves.length === 0) return
      for (const { from, to, ptyId } of moves) {
        // Logged because a tab stuck on the wrong session was invisible from outside: which tab
        // was rekeyed, from what to what, and whether it had been pending.
        window.apiary.logWrite('info', 'tabs', 'tab follows its terminal', {
          from, to: to.sessionId, ptyId, wasPending: pending.has(from),
        })
        const titleOverride = pending.get(from)?.titleOverride ?? null
        if (titleOverride !== null) {
          void window.apiary.renameSession(to.sessionId, titleOverride).catch((e: unknown) => {
            notifyError(e, 'Could not rename the session')
          })
        }
        const node = titleOverride !== null ? { ...to, title: titleOverride } : to
        setPtyOverrides((prev) => {
          const next = new Map(prev)
          next.delete(from)
          if (ptyId !== to.sessionId) next.set(to.sessionId, ptyId)
          return next
        })
        setResumed((prev) => {
          const next = new Set(prev)
          next.delete(from)
          next.add(to.sessionId)
          return next
        })
        setOpenSessions((prev) => {
          const next = new Map(prev)
          next.delete(from)
          next.set(to.sessionId, node)
          return next
        })
        // Shells stay where they are: they are filed by the pty the tab runs under (see
        // `keyFor`), which is `ptyId` before this and — through the override above — after it.
        // Moving them to the session id mislaid every shell the tab had open while pending.
        // Kept on the terminal: the tab was showing a live process, and still is. A rekeyed tab
        // otherwise falls back to the transcript view, pulling the user off what they were doing.
        setColumns((prevCols) => prevCols.map((c) =>
          setTabView(rekeyTab(c, from, to.sessionId), to.sessionId, 'terminal'),
        ))
        setPending((prev) => {
          if (!prev.has(from)) return prev
          const next = new Map(prev)
          next.delete(from)
          return next
        })
      }
    }) }
    check()
    const off = window.apiary.onTreeChanged(check)
    return () => { cancelled = true; off() }
  }, [ptySessions, columns, ptyOverrides, pending, notifyError, setColumns])

  // Restore the previously selected session on launch, once, from the id persisted last time.
  // If it no longer exists in the freshly loaded tree, fall back to no selection.
  const restoreAttempted = useRef(false)
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    // A detached window opens the tab it was torn off to show; an ordinary one reopens whatever
    // was last in front. Same machinery either way — the only difference is which id.
    const id = detached ?? ui.selectedSessionId
    if (id === null) return
    let cancelled = false
    window.apiary
      .tree()
      .then((nodes) => {
        if (cancelled) return
        const found = findSessionById(nodes, id)
        if (!found) return
        openSessionTab(found, false)
        if (arrival !== null && arrival.view !== 'transcript') {
          setColumns((prev) => prev.map((c) => setTabView(c, found.sessionId, arrival.view)))
        }
      })
      .catch((e: unknown) => {
        // Restoring the previous selection is best-effort — the app is perfectly usable with
        // nothing selected — so this is a warning rather than an error, and it says so instead
        // of leaving the user to wonder why the session they had open didn't come back.
        notifyError(e, 'Could not reopen the last session')
      })
    return () => { cancelled = true }
    // Intentionally runs once on mount only, against the id loaded at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Remembers which session is in front, so the next launch can reopen it (the restore effect
   * above consumes this). Deliberately never writes `null`: a pending tab has no session id worth
   * persisting, and blanking it while the app happens to have no tabs open would throw away the
   * restore target before the asynchronous restore has had a chance to use it.
   */
  useEffect(() => {
    if (activeKey === null || pending.has(activeKey)) return
    setUi((prev) => (prev.selectedSessionId === activeKey ? prev : { ...prev, selectedSessionId: activeKey }))
  }, [activeKey, pending])

  // Dragging the sidebar resizer updates ui.sidebarWidth live; it is persisted by the
  // saveUiState effect above like any other ui change, so it survives a relaunch. The
  // `resizing-active` class suppresses text selection for the duration of the drag — without it,
  // the repeated mousemove-over-text that dragging any adjacent element produces is indistinguishable
  // from a click-drag text selection to the browser, so surrounding content (the session title,
  // "Hide shell", etc.) visibly highlights as the cursor passes over it.
  useEffect(() => {
    if (!resizing) return
    document.body.classList.add('resizing-active', 'resizing-col')
    const onMove = (e: MouseEvent): void => {
      const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX))
      setUi((prev) => (prev.sidebarWidth === width ? prev : { ...prev, sidebarWidth: width }))
    }
    const onUp = (): void => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active', 'resizing-col')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  // Same pattern as the sidebar resizer above, but for the bottom shell pane's height. Dragging
  // up (decreasing clientY) should grow the pane, so height is measured as the distance from the
  // cursor to the bottom of the window rather than from the top.
  useEffect(() => {
    if (!resizingBottom) return
    document.body.classList.add('resizing-active', 'resizing-row')
    const onMove = (e: MouseEvent): void => {
      const height = Math.min(
        MAX_BOTTOM_HEIGHT,
        Math.max(MIN_BOTTOM_HEIGHT, window.innerHeight - e.clientY),
      )
      setUi((prev) => (prev.bottomHeight === height ? prev : { ...prev, bottomHeight: height }))
    }
    const onUp = (): void => setResizingBottom(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active', 'resizing-row')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizingBottom])

  /**
   * The tab bar's split button: the active session opened again beside the current pane, keeping
   * the view it was on. It stays open where it was too, matching VS Code's split and the sidebar's
   * own split button. With four panes it opens in the next pane instead (see `openBeside`).
   */
  const splitActiveTab = useCallback((key: string) => {
    // As above: one `setWindowState` update, computed against its own `prev` rather than the
    // render-time `layout`/`activeColumnId` — the pane tidy keeps in front, and the pane that
    // becomes active, is the one this very update is choosing, not whatever was active before it.
    setWindowState((prev) => {
      const tab = prev.layout.panes.flatMap((c) => c.tabs).find((t) => t.key === key)
      if (tab === undefined) return prev
      const result = openBeside(prev.layout, prev.activeColumnId, { ...tab })
      return { layout: tidyLayout(result.layout, result.paneId), activeColumnId: result.paneId }
    })
  }, [])

  const placeTarget = useCallback((target: PlaceTarget, preset: PresetId, zone: number) => {
    const key = target.kind === 'tab' ? target.key : target.session.sessionId
    if (target.kind === 'session') {
      const node = target.session
      setOpenSessions((prev) => new Map(prev).set(node.sessionId, node))
    }
    setWindowState((prev) => {
      const result = placeInZone(prev.layout, preset, zone, key, target.kind === 'tab' ? target.paneId : undefined)
      return { layout: tidyLayout(result.layout, result.paneId), activeColumnId: result.paneId }
    })
  }, [])

  const applyLayout = useCallback((preset: PresetId) => {
    setLayout((prev) => applyPreset(prev, preset))
  }, [setLayout])

  /** A picker opened from a context menu's "Arrange…", which has no button to hang it from. */
  const [requestedPicker, setRequestedPicker] = useState<{ target: PlaceTarget; at: DOMRect } | null>(null)

  const layoutActions: LayoutActions = {
    preset: layout.preset,
    place: placeTarget,
    apply: applyLayout,
    requestPicker: (target, at) => { setRequestedPicker({ target, at: new DOMRect(at.x, at.y, 0, 0) }) },
    isOpen: (key) => findColumnWithTab(columns, key) !== null,
  }

  // A requested picker (opened from a context menu, with no button of its own to anchor a
  // blur/mousedown handler to) has to close itself on an outside click.
  useEffect(() => {
    if (requestedPicker === null) return
    const close = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest('[data-testid="layout-picker"]') == null) setRequestedPicker(null)
    }
    window.addEventListener('mousedown', close)
    return () => { window.removeEventListener('mousedown', close) }
  }, [requestedPicker])

  // Records a rename typed in before this pending session had a real id yet — held in-memory
  // (see PendingSession.titleOverride) until the reconciliation effect above can apply it.
  const setPendingTitle = useCallback((ptyId: string, title: string) => {
    // Also typed into that Claude as `/rename`. Beyond naming it where VS Code and /resume look,
    // this is what lets the tab resolve: a fork or new session writes no transcript until
    // something happens in it — measured on a real Haiku fork — so a renamed but untouched tab
    // otherwise waited, still `new:…`, however often Refresh was pressed. The rename makes Claude
    // write the transcript, the tab follows it, and the title below is applied as a real rename.
    if (title.trim() !== '') window.apiary.renameTerminalInClaude(ptyId, title)
    setPending((prev) => {
      const info = prev.get(ptyId)
      if (!info) return prev
      const next = new Map(prev)
      next.set(ptyId, { ...info, titleOverride: title })
      return next
    })
  }, [])

  /**
   * Pins (or unpins) a session. Newly pinned ids go to the front, so the pinned section reads
   * most-recent-first rather than in whatever order the tree happened to hand them over.
   */
  const togglePin = useCallback((session: SessionNode) => {
    setUi((prev) => ({
      ...prev,
      pinned: prev.pinned.includes(session.sessionId)
        ? prev.pinned.filter((id) => id !== session.sessionId)
        : [session.sessionId, ...prev.pinned],
    }))
  }, [])

  /** Drops an id from the pinned list, used when the session behind it is removed from view. */
  const unpin = useCallback((sessionId: string) => {
    setUi((prev) => (prev.pinned.includes(sessionId)
      ? { ...prev, pinned: prev.pinned.filter((id) => id !== sessionId) }
      : prev))
  }, [])

  const setCollapsed = useCallback((next: Set<string>) => {
    setUi((prev) => {
      const list = [...next].sort()
      if (list.join(' ') === [...prev.collapsed].sort().join(' ')) return prev
      return { ...prev, collapsed: list }
    })
  }, [])

  const onSelect = useCallback((session: SessionNode) => {
    openSessionTab(session, false)
  }, [openSessionTab])

  /** The sidebar's split button: same session, but in a column of its own beside the current one. */
  const onSplitSession = useCallback((session: SessionNode) => {
    openSessionTab(session, true)
  }, [openSessionTab])

  /**
   * Keeps the rows behind the open tabs current. Titles change (Claude writes one asynchronously,
   * and the user can rename), and a session goes live or stops being live — a tab holding a frozen
   * copy from the moment it was opened would show stale text and a stale resume state.
   */
  useEffect(() => window.apiary.onTreeChanged(() => {
    void window.apiary.tree().then((nodes) => {
      setOpenSessions((prev) => {
        if (prev.size === 0) return prev
        let changed = false
        const next = new Map(prev)
        for (const [id, current] of prev) {
          const fresh = findSessionById(nodes, id)
          if (fresh === null) continue
          if (
            fresh.title !== current.title ||
            fresh.isLive !== current.isLive ||
            fresh.cwd !== current.cwd ||
            fresh.cwdExists !== current.cwdExists
          ) {
            next.set(id, fresh)
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
  }), [])

  const onNewSession = useCallback(async (path: string) => {
    try {
      const [info, nodes] = await Promise.all([
        window.apiary.newSessionInProject(path),
        window.apiary.tree(),
      ])
      addPending(info, nodes)
    } catch (e) {
      notifyError(e, 'Could not start a new session')
    }
  }, [addPending, notifyError])

  /**
   * Forks a session from a tab or a sidebar row: a new conversation seeded with this one's, opened
   * beside it, leaving the original untouched.
   *
   * The fork has no session id yet — Claude mints one when it writes the JSONL — so this goes
   * through exactly the same pending-pty bookkeeping as starting a session from scratch, and the
   * `fork: …` title rides along as a `titleOverride` that is applied as a real rename the moment
   * the session resolves. Doing it that way rather than renaming afterwards means there is never a
   * moment where the fork and its original are two rows with the same name.
   */
  const forkSession = useCallback(async (sessionId: string) => {
    try {
      const [info, nodes] = await Promise.all([
        window.apiary.forkSession(sessionId),
        window.apiary.tree(),
      ])
      addPending(info, nodes, { titleOverride: info.label, after: sessionId })
      notify({ message: `Forking — ${info.label}` })
    } catch (e) {
      notifyError(e, 'Could not fork this session')
    }
  }, [addPending, notify, notifyError])

  const startResume = useCallback(async (session: SessionNode) => {
    try {
      await window.apiary.resume(session.sessionId)
      setResumed((prev) => new Set([...prev, session.sessionId]))
      setColumns((prev) => prev.map((c) => setTabView(c, session.sessionId, 'terminal')))
    } catch (e) {
      notifyError(e, 'Could not resume this session')
    }
  }, [notifyError])

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await window.apiary.removeSession(target.sessionId)
      // A session that is no longer in the tree has nothing left to show, so close every tab
      // pointing at it rather than leaving a stale header behind in some column.
      setColumns((prev) => prev.map((c) => closeTab(c, target.sessionId)))
      setOpenSessions((prev) => {
        if (!prev.has(target.sessionId)) return prev
        const next = new Map(prev)
        next.delete(target.sessionId)
        return next
      })
      unpin(target.sessionId)
    } catch (e) {
      notifyError(e, 'Could not remove this session')
    }
  }, [deleteTarget, notifyError, unpin])

  /** The session a resume/conflict decision is currently about — set when the ResumeBar asks. */
  const [resumeTarget, setResumeTarget] = useState<SessionNode | null>(null)

  const onResume = useCallback(async (session: SessionNode) => {
    if (resumed.has(session.sessionId)) {
      setColumns((prev) => prev.map((c) => setTabView(c, session.sessionId, 'terminal')))
      return
    }
    const existing = await window.apiary.checkConflict(session.sessionId)
    if (existing !== null) { setResumeTarget(session); setConflict(existing); return }
    await startResume(session)
  }, [resumed, startResume, setColumns])

  /**
   * Resume for the composer: resolves only once there is a process to type into.
   *
   * Distinct from `onResume` above, which is free to hand off to the conflict dialog and return
   * having started nothing. A composer that sent as soon as *that* resolved would be typing into a
   * session the user has not yet agreed to open. Here a conflict is a refusal, stated as one.
   */
  const resumeAndWait = useCallback(async (session: SessionNode) => {
    if (resumed.has(session.sessionId)) return
    const existing = await window.apiary.checkConflict(session.sessionId)
    if (existing !== null) {
      setResumeTarget(session)
      setConflict(existing)
      throw new Error('This session is already running elsewhere — choose how to open it first.')
    }
    await window.apiary.resume(session.sessionId)
    setResumed((prev) => new Set([...prev, session.sessionId]))
    setColumns((prev) => prev.map((c) => setTabView(c, session.sessionId, 'terminal')))
  }, [resumed, setColumns])

  /** Every session id currently open in some column, so the sidebar can list only the pending
   *  sessions that aren't already reachable as a tab. */
  const openKeys = new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))

  /**
   * Keeps `resumed` in step with the ptys the main process actually has.
   *
   * `resumed` started life as a record of what *this window* had started, and that was wrong in
   * two ways that both ended at a blank pane: a second window knew nothing of a session the first
   * had opened, and a relaunched window restored a tab still set to its terminal view with no
   * terminal behind it. Whether a session has a process is main-process state, so it is asked for
   * rather than remembered — cheaply, since it is a set-membership test over ids the window
   * already holds.
   *
   * Only ever *adds*: a pty that has gone away arrives as `onPtyExit`, which is the event that
   * knows the exit code and does the rest of the tidying.
   */
  const openKeysSignature = [...openKeys].sort((a, b) => a.localeCompare(b)).join(' ')
  useEffect(() => {
    const keys = openKeysSignature === '' ? [] : openKeysSignature.split(' ')
    if (keys.length === 0) return
    // A pending tab is keyed by its pty id already; a resolved one may have been started under a
    // different pty id, which `ptyOverrides` remembers.
    const ptyIdOf = new Map(keys.map((k) => [ptyOverrides.get(k) ?? k, k]))
    void window.apiary.ptyRunning([...ptyIdOf.keys()])
      .then((running) => {
        const live = running.map((id) => ptyIdOf.get(id)).filter((k): k is string => k !== undefined)
        setResumed((prev) => {
          const missing = live.filter((k) => !prev.has(k))
          return missing.length === 0 ? prev : new Set([...prev, ...missing])
        })
      })
      // A window that cannot ask is a window that shows what it knew, which is where it was
      // before this existed.
      .catch(() => { /* as above */ })
  }, [openKeysSignature, ptyOverrides])

  /** This window's own number, the same key `uiState.ts`'s `stateKey()` reads from the URL. */
  const windowNumber = useMemo(() => {
    try {
      return Number(new URLSearchParams(window.location.search).get('w') ?? '1') || 1
    } catch {
      return 1
    }
  }, [])

  /**
   * The actual send, kept in a ref rather than only inside the debounced effect below so it can
   * also be called *immediately*, bypassing the debounce, when main asks for a flush before quit
   * (see the `onRequestLayoutFlush` effect). The ref is refreshed on every render so it always
   * closes over the latest layout/shell state, the same values the debounced call would have used.
   */
  const reportLayoutNowRef = useRef<() => void>(() => {})
  reportLayoutNowRef.current = () => {
    const persistedLayout = buildPersistedLayout(layout, shellTabs, activeTerminal, ptyOverrides)
    const live = [...resumed].filter((id) => openKeys.has(id))
    void window.apiary.reportLayout({ number: windowNumber, layout: persistedLayout, live })
      .catch(() => { /* the next change tries again; nothing to show for a dropped report */ })
  }

  /**
   * What this window has open, for the Active section — a separate report from the layout one
   * above, and deliberately not gated on `detached`.
   *
   * These two were once the same send, which quietly made the Active section blind to exactly the
   * windows it exists for: a torn-off window is excluded from the *layout* record (it is not part
   * of the restorable arrangement), and that exclusion took its tab report with it. A session
   * dragged out to a second screen — the case where you most need to see at a glance that it is
   * running or waiting on you — was the one case mission control never listed.
   *
   * `resumed` is what marks a tab as actually running a pty at all (a plain transcript tab nobody
   * has resumed has none); `ptyOverrides` is the same "which id does its process actually run
   * under" lookup `transferFor` and `buildPersistedLayout` already use.
   */
  const reportTabsNowRef = useRef<() => void>(() => {})
  reportTabsNowRef.current = () => {
    window.apiary.reportTabs(columns.flatMap((c) => c.tabs).map((t) => {
      const p = pending.get(t.key)
      return {
        key: t.key,
        view: t.view,
        ptyId: resumed.has(t.key) ? (ptyOverrides.get(t.key) ?? t.key) : null,
        // What the tab bar shows for a tab with no session yet — Active, in any window, has no
        // other way to name it, and fell back to the raw `new:<uuid>` key.
        label: p === undefined ? null : (p.titleOverride ?? p.label),
      }
    }))
  }

  /**
   * Reports this window's layout to main, debounced ~500ms so a drag or a burst of tab churn does
   * not spam the IPC channel and the disk write behind it. `detached` windows are excluded: a
   * torn-off single-tab window is not part of the restorable arrangement (see Task 3).
   */
  useEffect(() => {
    if (detached !== null) return
    const timer = setTimeout(() => { reportLayoutNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, detached, windowNumber])

  /**
   * Reports this window's open tabs, every window including a detached one. Debounced on the same
   * 500ms as the layout report above and driven by the same state, so the registry and the
   * persisted record still agree about an ordinary window — but a torn-off window reports too,
   * which is the whole point of keeping this separate (see `reportTabsNowRef`).
   */
  useEffect(() => {
    const timer = setTimeout(() => { reportTabsNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, windowNumber, pending])

  /**
   * Quitting can land inside the 500ms debounce above — close the last tab in a pane, then Cmd+Q
   * within half a second, and without this the persisted record would still show that tab. Main's
   * `before-quit` handler broadcasts this request to every window and waits (briefly, bounded) for
   * each to report before it writes the file, so the on-disk state always reflects what was open
   * the instant before quit actually happened.
   */
  useEffect(() => {
    if (detached !== null) return
    return window.apiary.onRequestLayoutFlush(() => { reportLayoutNowRef.current() })
  }, [detached])

  /**
   * Fills in the SessionNode behind any tab this window has not looked up yet.
   *
   * A tab normally arrives through `openSessionTab`, which brings its node with it — but a tab
   * dropped in from *another window* arrives as a bare key, and without this the column would have
   * a tab with no session behind it: no title on the strip, and a blank header over a blank pane.
   */
  useEffect(() => {
    const keys = openKeysSignature === '' ? [] : openKeysSignature.split(' ')
    const unknown = keys.filter((k) => !pending.has(k) && !openSessions.has(k))
    if (unknown.length === 0) return
    let cancelled = false
    void window.apiary.tree()
      .then((nodes) => {
        if (cancelled) return
        const found = unknown
          .map((k) => findSessionById(nodes, k))
          .filter((n): n is SessionNode => n !== null && n !== undefined)
        if (found.length === 0) return
        setOpenSessions((prev) => {
          const next = new Map(prev)
          for (const node of found) next.set(node.sessionId, node)
          return next
        })
      })
      .catch(() => { /* the refresh effect below asks again on the next tree change */ })
    return () => { cancelled = true }
  }, [openKeysSignature, pending, openSessions])

  /**
   * A tab dragged from another window has been dropped on this one.
   *
   * It arrives as a bare key with no position: the drop is worked out in the main process from
   * where the pointer was released (there is no drop event in this window to carry an index), so
   * the tab goes to the end of the active column — which is where a tab dropped past the last one
   * would have gone anyway.
   */
  useEffect(() => window.apiary.onTabAdopt((tab) => {
    if (!isTabTransfer(tab)) return
    // The processes first, so that by the time the tab renders it already knows what it runs.
    const shellKey = tab.ptyId ?? tab.key
    if (tab.ptyId !== null) {
      const ptyId = tab.ptyId
      setPtyOverrides((prev) => (prev.get(tab.key) === ptyId ? prev : new Map(prev).set(tab.key, ptyId)))
    }
    // Replaces rather than merges: the window the tab came from was the one using these shells,
    // and anything this window remembers for the same session is from before it last let go of it.
    if (tab.shells.length > 0) setShellTabs((prev) => new Map(prev).set(shellKey, tab.shells))
    if (tab.activeShell !== null) {
      const active = tab.activeShell
      setActiveTerminal((prev) => new Map(prev).set(shellKey, active))
    }
    setColumns((prev) => {
      const targetId = prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id
      const target = prev.find((c) => c.id === targetId)
      return target === undefined ? prev : adoptTab(prev, tab.key, target.id, target.tabs.length, tab.view)
    })
  }), [activeColumnId, setColumns])

  /** Everything about an open tab another window would need to carry on with it. */
  const transferFor = (key: string): TabTransfer => {
    const ptyId = ptyOverrides.get(key) ?? null
    const shellKey = ptyId ?? key
    return {
      key,
      view: columns.flatMap((c) => c.tabs).find((t) => t.key === key)?.view ?? 'transcript',
      ptyId,
      shells: shellTabs.get(shellKey) ?? [],
      activeShell: activeTerminal.get(shellKey) ?? null,
    }
  }

  /**
   * Another window has taken a tab this one was showing, so let go of it.
   *
   * This is what makes dragging a tab between windows a *move*. Opening the same session in two
   * windows on purpose is still allowed — that goes through the sidebar and never announces a
   * claim — so the two gestures stay distinguishable.
   */
  useEffect(() => window.apiary.onTabClaimed((key) => {
    setColumns((prev) => prev.map((c) => closeTab(c, key)))
  }), [setColumns])

  /**
   * Another window's Active row was clicked for a tab this window already has open — focus it
   * where it already is, the same "go to it rather than open it again" rule `openSessionTab` uses,
   * just against a bare key instead of a full `SessionNode`.
   */
  useEffect(() => window.apiary.onSelectTab((key) => {
    setColumns((prev) => {
      const existing = findColumnWithTab(prev, key)
      if (existing === null) return prev
      setActiveColumnId(existing.id)
      return prev.map((c) => (c.id === existing.id ? openTab(c, key) : c))
    })
  }), [setColumns])

  const pendingTabInfo = new Map(
    [...pending.values()].map((info) => [
      info.ptyId,
      { ptyId: info.ptyId, cwd: info.cwd, label: info.titleOverride ?? info.label },
    ]),
  )

  // Rebuilt only when the set of open keys actually changes, so PaneFiller's own memo (keyed on
  // this set) isn't invalidated by every unrelated render of App.
  const openKeySet = useMemo(
    () => new Set(openKeysSignature === '' ? [] : openKeysSignature.split(' ')),
    [openKeysSignature],
  )

  return (
    <LayoutContext.Provider value={layoutActions}>
    <ThemeEffects
      effects={applied?.effects ?? []}
      animated={theme.options.animated}
      intensity={theme.options.intensity}
      glass={applied?.material.kind === 'glass' ? applied.material : null}
      lowPower={!gpuCompositing}
    />
    <div className="app-shell">
      {updateStatus !== null && (
        <UpdateBanner status={updateStatus} onOpenSettings={() => setSettingsSection('updates')} />
      )}
      <div
        className="layout"
        data-detached={detached !== null}
        style={{
          // The same for a torn-off window as any other: it keeps the sidebar (hidden to the rail
          // by default, see uiState), so the library is never out of reach from it.
          gridTemplateColumns: ui.sidebarHidden
            ? 'var(--sidebar-rail-width) 1fr'
            : String(ui.sidebarWidth) + 'px max(var(--panel-gap), 4px) 1fr',
        }}
        data-sidebar-hidden={ui.sidebarHidden}
      >
      {ui.sidebarHidden && (
        // A rail rather than nothing: a sidebar hidden with no visible way back is one someone has
        // to remember a shortcut to recover, which is a sidebar that has gone missing.
        <div className="sidebar-rail" data-testid="sidebar-rail">
          <button
            className="icon-button"
            data-testid="sidebar-show"
            title={`Show sidebar (${SIDEBAR_SHORTCUT})`}
            aria-label="Show sidebar"
            onClick={toggleSidebar}
          >
            <SidebarIcon />
          </button>
        </div>
      )}
      {(
      <Sidebar
        key={treeNonce}
        // Hidden, not unmounted, so the search typed into it and where it was scrolled to are
        // still there when it comes back.
        hidden={ui.sidebarHidden}
        onHide={toggleSidebar}
        hideTitle={`Hide sidebar (${SIDEBAR_SHORTCUT})`}
        onForkSession={(sessionId) => { void forkSession(sessionId) }}
        onEditNote={(session) => {
          // Read from the main process rather than from the tree node, so the editor opens on
          // what is actually saved even if this window's tree is a moment out of date.
          void window.apiary.sessionNote(session.sessionId)
            .then((note) => { setNoteTarget({ session, note }) })
            .catch(() => { setNoteTarget({ session, note: session.note ?? '' }) })
        }}
        selectedId={activeKey}
        revealId={revealActiveInSidebar ? activeKey : null}
        searchChatContent={searchChatContent}
        searchSessionNotes={searchSessionNotes}
        groupState={{
          groups: ui.groups,
          assignments: ui.groupAssignments,
          collapsed: ui.groupsCollapsed,
          folderOrder: ui.folderOrder,
        }}
        onGroupStateChange={(next: GroupState) => setUi((prev) => ({
          ...prev,
          groups: next.groups,
          groupAssignments: next.assignments,
          groupsCollapsed: next.collapsed,
          folderOrder: next.folderOrder,
        }))}
        onReorderPinned={(id, beforeId) => setUi((prev) => ({
          ...prev,
          pinned: moveBefore(prev.pinned, id, beforeId),
        }))}
        onSelect={onSelect}
        onSplitSession={onSplitSession}
        collapsed={new Set(ui.collapsed)}
        onCollapsedChange={setCollapsed}
        onNewSession={(path) => { void onNewSession(path) }}
        onDeleteSession={setDeleteTarget}
        onSessionDropped={(session, toPath) => setMoveTarget({ session, toPath })}
        pinned={ui.pinned}
        onTogglePin={togglePin}
        pinnedCollapsed={ui.pinnedCollapsed}
        onPinnedCollapsedChange={(next) => setUi((prev) => ({ ...prev, pinnedCollapsed: next }))}
        recentSectionEnabled={recentSectionEnabled}
        recentSectionHours={recentSectionHours}
        dismissedRecent={ui.dismissedRecent}
        recentCollapsed={ui.recentCollapsed}
        onRecentCollapsedChange={(next) => setUi((prev) => ({ ...prev, recentCollapsed: next }))}
        onDismissRecent={(session) => setUi((prev) => ({
          ...prev,
          dismissedRecent: dismissRecent(prev.dismissedRecent, session.sessionId, Date.now()),
        }))}
        pending={[...pending.values()]
          .filter((p) => !openKeys.has(p.ptyId))
          .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd }))}
        onSelectPending={(ptyId) => {
          setColumns((prev) => {
            const targetId = prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id
            return prev.map((c) => (c.id === targetId ? openTab(c, ptyId) : c))
          })
        }}
        activeTabs={activeTabs}
        onFocusTab={(w, key) => void window.apiary.focusTab(w, key)}
      />
      )}

      {!ui.sidebarHidden && (
        <div
          className="sidebar-resizer"
          data-testid="sidebar-resizer"
          onMouseDown={(e) => { e.preventDefault(); setResizing(true) }}
        />
      )}

      <main
        className="content"
        data-testid="content"
        data-preset={layout.preset}
        style={{
          gridTemplateColumns: trackTemplate(currentTracks.cols),
          gridTemplateRows: trackTemplate(currentTracks.rows),
        }}
      >
        {columns.map((column, index) => (
          // Per pane, not just once around the whole app: a pane whose session renders badly (a
          // transcript with something unexpected in it, say) should fail inside its own zone and
          // leave the sidebar and the other panes working, rather than blanking the window.
          <ErrorBoundary
            key={column.id}
            label="This session"
            onError={(thrown, componentStack) => {
              const { message, detail } = describeError(thrown)
              notify({
                kind: 'error',
                message: `This session could not be displayed: ${message}`,
                detail: [detail, componentStack].filter((t) => t !== null && t !== '').join('\n'),
              })
            }}
            style={{ gridArea: `z${String(index + 1)}` }}
          >
          <SessionColumn
            gridArea={`z${String(index + 1)}`}
            column={column}
            sessions={openSessions}
            pending={pendingTabInfo}
            resumed={resumed}
            ptyOverrides={ptyOverrides}
            shellTabs={shellTabs}
            setShellTabs={setShellTabs}
            activeTerminal={activeTerminal}
            setActiveTerminal={setActiveTerminal}
            bottomHeight={ui.bottomHeight}
            onStartBottomResize={() => setResizingBottom(true)}
            isActive={column.id === activeColumn?.id}
            onFocus={() => setActiveColumnId(column.id)}
            onActivateTab={(key) => {
              setActiveColumnId(column.id)
              setColumns((prev) => prev.map((c) => (c.id === column.id ? openTab(c, key) : c)))
            }}
            onCloseTab={(key) => closeSessionTab(column.id, key)}
            onSetView={(key, view) => {
              setColumns((prev) => prev.map((c) => (c.id === column.id ? setTabView(c, key, view) : c)))
            }}
            onResume={(session) => { void onResume(session) }}
            onResumeAsync={resumeAndWait}
            onRenameSession={(session, title) => {
              setOpenSessions((prev) => new Map(prev).set(session.sessionId, { ...session, title }))
              void window.apiary.renameSession(session.sessionId, title).catch((e: unknown) => {
                notifyError(e, 'Could not rename the session')
              })
            }}
            onRenamePending={setPendingTitle}
            onSplitActive={splitActiveTab}
            transferFor={transferFor}
            onReorderTab={(key, toIndex, transfer) => {
              // Not open anywhere in this window: it came from another one, whose drop the platform
              // delivered here rather than as a `dragend` over nothing (X11 does this). Moving it
              // within this window would silently do nothing — the reported "dragging it back to
              // the main window does nothing" — so ask the main process to hand it over instead.
              if (!openKeys.has(key)) {
                if (transfer !== null) {
                  void window.apiary.tabAdoptHere(transfer).catch((e: unknown) => {
                    notifyError(e, 'Could not move this tab')
                  })
                }
                return
              }
              // The tab may have been dragged in from another column, so this cannot be a change
              // to this column alone — a move has to leave the column it came from at the same
              // time, or the same session ends up open twice.
              setColumns((prev) => moveTabToColumn(prev, key, column.id, toIndex), column.id)
              setActiveColumnId(column.id)
            }}
            pinnedKeys={pinnedKeys}
            onTogglePin={(key) => {
              // A pending tab has no session row to pin yet, so the menu simply does nothing for
              // it rather than pinning an id that will be replaced the moment it resolves.
              const session = openSessions.get(key)
              if (session) togglePin(session)
            }}
            onFork={(key) => { void forkSession(key) }}
            onSessionStarted={(info) => {
              // A session started from the worktree-conflict dialog is a new session like any
              // other: it has no id until Claude writes one, so it goes through the same pending
              // bookkeeping rather than a path of its own.
              void window.apiary.tree().then((nodes) => { addPending(info, nodes) })
                .catch((e: unknown) => { notifyError(e, 'Could not open that session') })
            }}
            onTabDropped={(key, at) => {
              void window.apiary.tabDropped(transferFor(key), at).catch((e: unknown) => {
                notifyError(e, 'Could not move this tab')
              })
            }}
            onDetach={(key, at) => {
              void window.apiary.tabDetach(transferFor(key), at).catch((e: unknown) => {
                notifyError(e, 'Could not open this session in a new window')
              })
            }}
            layoutButton={index === presetDef(layout.preset).topRight ? (
              <LayoutMenuButton
                className="session-tab-split window-layout-button"
                testId="window-layout-button"
                title="Layout"
                ariaLabel="Change layout"
                heading="Layout"
                mode="layout"
                onPick={(preset) => { applyLayout(preset) }}
              >
                <LayoutIcon />
              </LayoutMenuButton>
            ) : undefined}
            emptyContent={column.placeholder === true ? (
              <PaneFiller
                openTabs={columns
                  // A pane's only tab is excluded: moving it would empty that pane and step the
                  // layout down, so the click would look like it did nothing. The picker can still
                  // move it deliberately.
                  .filter((c) => c.id !== column.id && c.tabs.length > 1)
                  .flatMap((c) => c.tabs)
                  .map((t) => ({
                    key: t.key,
                    label: openSessions.get(t.key)?.title ?? pendingTabInfo.get(t.key)?.label ?? t.key,
                  }))}
                exclude={openKeySet}
                onMoveHere={(key) => {
                  setColumns((prev) => moveTabToColumn(prev, key, column.id, 0), column.id)
                  setActiveColumnId(column.id)
                }}
                onOpenHere={(session) => {
                  setOpenSessions((prev) => new Map(prev).set(session.sessionId, session))
                  setColumns((prev) => prev.map((c) => (c.id === column.id ? openTab(c, session.sessionId) : c)))
                  setActiveColumnId(column.id)
                }}
                onClosePane={() => { setLayout((prev) => closePane(prev, column.id, activeColumnId)) }}
              />
            ) : undefined}
          />
          </ErrorBoundary>
        ))}
        <PaneDividers
          preset={layout.preset}
          tracks={currentTracks}
          onChange={(next) => { setTracks((prev) => new Map(prev).set(layout.preset, next)) }}
        />
      </main>

      {requestedPicker !== null && (
        <LayoutPicker
          anchor={requestedPicker.at}
          mode="place"
          heading="Arrange"
          current={layout.preset}
          onPick={(preset, zone) => {
            const target = requestedPicker.target
            setRequestedPicker(null)
            // The target was captured when the picker opened; by the time a zone is picked the
            // tab it named may have closed. Placing it then would reopen a session nobody asked
            // for, so a tab target that is no longer open in the window is silently dropped.
            if (target.kind === 'tab' && findColumnWithTab(columns, target.key) === null) return
            placeTarget(target, preset, zone)
          }}
          onClose={() => { setRequestedPicker(null) }}
        />
      )}

      {conflict !== null && resumeTarget !== null && (
        <ConflictDialog
          conflict={conflict}
          onCancel={() => { setConflict(null); setResumeTarget(null) }}
          onFork={() => {
            setConflict(null)
            setResumeTarget(null)
            // Forking goes through the fork path, not through resume-with-a-flag. The old code
            // marked the *original* session resumed and pointed its tab at a pty that was in fact
            // running a different, newly-minted session — so the original's transcript never
            // moved and the fork turned up later as a row with no terminal behind it.
            void forkSession(resumeTarget.sessionId)
          }}
          onOpenAnyway={() => { setConflict(null); setResumeTarget(null); void startResume(resumeTarget) }}
        />
      )}

      {deleteTarget !== null && (
        <DeleteSessionDialog
          title={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => { void confirmDelete() }}
        />
      )}

      {moveTarget !== null && (
        <MoveSessionDialog
          sessionTitle={moveTarget.session.title}
          fromPath={moveTarget.session.cwd}
          toPath={moveTarget.toPath}
          onCancel={() => setMoveTarget(null)}
          onConfirm={() => {
            const { session, toPath } = moveTarget
            setMoveTarget(null)
            void window.apiary.moveSession(session.sessionId, toPath)
              .catch((e: unknown) => notifyError(e, 'Could not move session'))
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => setTreeNonce((n) => n + 1)}
          width={ui.importDialogWidth}
          onWidthChange={(next) => setUi((prev) => ({ ...prev, importDialogWidth: next }))}
        />
      )}

      {settingsSection !== null && (
        <SettingsDialog
          initialSection={settingsSection}
          onClose={() => { setSettingsSection(null); loadUiSettings() }}
        />
      )}

      {noteTarget !== null && (
        <NoteDialog
          sessionTitle={noteTarget.session.title}
          initial={noteTarget.note}
          onClose={() => { setNoteTarget(null) }}
          onSave={(note) => {
            const id = noteTarget.session.sessionId
            setNoteTarget(null)
            void window.apiary.setSessionNote(id, note).catch((e: unknown) => {
              notifyError(e, 'Could not save the note')
            })
          }}
        />
      )}
      </div>
    </div>
    </LayoutContext.Provider>
  )
}
