import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { NewSessionInfo, ProjectNode, ResumeConflict, SessionNode } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { SessionColumn, type TerminalTab } from './components/SessionColumn'
import { ConflictDialog } from './components/ConflictDialog'
import { DeleteSessionDialog } from './components/DeleteSessionDialog'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import {
  newColumn, openTab, closeTab, setTabView, rekeyTab,
  type Column,
} from './state/columns'
import { loadUiState, saveUiState, type UiState } from './state/uiState'
import { useNotifications } from './state/notifications'
import { ErrorBoundary } from './components/ErrorBoundary'
import { describeError } from './errors'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 600

// Floor keeps the toolbar plus a few rows of terminal usable; ceiling leaves the transcript
// area above it readable rather than squeezed to a sliver.
const MIN_BOTTOM_HEIGHT = 120
const MAX_BOTTOM_HEIGHT = 560

// Narrow enough that three or four columns still fit on a laptop screen, wide enough that a
// session's header and toolbar are still readable rather than a stack of ellipses.
const MIN_COLUMN_WIDTH = 220

/**
 * The one invariant every column update goes through: a column with no tabs left in it is dropped,
 * unless it is the only one — in which case it stays as the empty placeholder that gives the next
 * click somewhere to land.
 *
 * Applied here, centrally, rather than at each call site. Several different things close a tab
 * (the close button, removing a session, a pending session's pty exiting before it ever resolved)
 * and each one used to be individually responsible for remembering this; the ones that forgot left
 * a blank column sitting beside the real ones, which is what "an empty side section appeared"
 * looks like. Now it cannot be forgotten, because there is only one place to forget it.
 */
function pruneColumns(columns: Column[]): Column[] {
  const kept = columns.filter((c) => c.tabs.length > 0)
  if (kept.length === columns.length) return columns
  return kept.length > 0 ? kept : [columns[0] ?? newColumn()]
}

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
  /**
   * Open sessions, arranged as VS Code-style editor groups: one column per group, each with its
   * own tab strip and its own shell. Splitting a session from the sidebar appends a column; there
   * is always at least one, even when empty, so there is somewhere for the next click to land.
   */
  const [columnsRaw, setColumnsRaw] = useState<Column[]>(() => [newColumn()])
  const columns = columnsRaw
  /** Every column update goes through `pruneColumns` — see the note on it above. */
  const setColumns = useCallback(
    (update: (prev: Column[]) => Column[]) => { setColumnsRaw((prev) => pruneColumns(update(prev))) },
    [],
  )
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)
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
  const [ptyOverrides, setPtyOverrides] = useState<Map<string, string>>(new Map())
  // Every new-session pty currently awaiting its first JSONL, keyed by pty id (not a single
  // value) so more than one can be in flight — see PendingSession above.
  const [pending, setPending] = useState<Map<string, PendingSession>>(new Map())
  /**
   * Shell terminals per session, keyed the way `SessionColumn` keys them. Deliberately global
   * rather than per column: two columns showing the same session must share one set of terminals,
   * or they would each spawn `shell:<key>:1` and silently kill each other's shell.
   */
  const [shellTabs, setShellTabs] = useState<Map<string, TerminalTab[]>>(new Map())
  const [activeTerminal, setActiveTerminal] = useState<Map<string, string>>(new Map())
  const [conflict, setConflict] = useState<ResumeConflict | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionNode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [treeNonce, setTreeNonce] = useState(0)
  const [resizing, setResizing] = useState(false)
  const [resizingBottom, setResizingBottom] = useState(false)
  /**
   * Relative widths of the open columns, as flex-grow weights keyed by column id.
   *
   * Weights rather than pixel widths, deliberately: a column is `flex: 1` by default, so anything
   * absent from this map keeps sharing the space evenly, and a window resize redistributes the
   * columns in the proportions the user dragged them to instead of leaving fixed pixel columns
   * with a gap (or an overflow) beside them. Not persisted — columns themselves only exist for as
   * long as the split does.
   */
  const [columnWeights, setColumnWeights] = useState<Map<string, number>>(new Map())
  /** The divider currently being dragged: the two columns it sits between, and where it started. */
  const [columnDrag, setColumnDrag] = useState<
    { leftId: string; rightId: string; startX: number; leftWidth: number; rightWidth: number } | null
  >(null)

  const activeColumn = columns.find((c) => c.id === activeColumnId) ?? columns[0]
  const activeKey = activeColumn?.activeKey ?? null

  /** Opens a session in the focused column, or in a brand-new column beside it when splitting. */
  const openSessionTab = useCallback((session: SessionNode, split: boolean) => {
    setOpenSessions((prev) => new Map(prev).set(session.sessionId, session))
    if (split) {
      const column = newColumn([{ key: session.sessionId, view: 'transcript' }])
      setColumns((prev) => [...prev, column])
      setActiveColumnId(column.id)
      return
    }
    setColumns((prev) => {
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
  useEffect(() => window.apiary.onOpenImportDialog(() => setImportOpen(true)), [])
  useEffect(() => window.apiary.onOpenSettingsDialog(() => setSettingsOpen(true)), [])

  // Registers a freshly-started new session as pending and opens it as a tab — shared by both
  // entry points (the sidebar "+" button and the File menu item below). The tab is keyed by pty
  // id until the watcher finds the session's real id, at which point the reconciler below rekeys
  // it in place.
  const addPending = useCallback((info: NewSessionInfo, nodes: ProjectNode[]) => {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(info.ptyId, { ...info, knownSessionIds: collectSessionIds(nodes), titleOverride: null })
      return next
    })
    setColumns((prev) => {
      const targetId = prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id
      return prev.map((c) => (c.id === targetId ? openTab(c, info.ptyId) : c))
    })
  }, [activeColumnId])

  // `File > New Session in Folder...` picks its folder via a native dialog in the main process
  // (never from the renderer) and pushes the result here once the pty is already running.
  useEffect(() => window.apiary.onNewSessionStarted((info) => {
    void window.apiary.tree('').then((nodes) => { addPending(info, nodes) })
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
    setColumns((prev) => prev.map((c) => closeTab(c, id)))

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
      void window.apiary.tree('').then((nodes) => {
        if (cancelled) return
        const claimed = new Set<string>()
        for (const [ptyId, info] of pending) {
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
  }, [pending, ptyOverrides, notifyError])

  // Restore the previously selected session on launch, once, from the id persisted last time.
  // If it no longer exists in the freshly loaded tree, fall back to no selection.
  const restoreAttempted = useRef(false)
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    const id = ui.selectedSessionId
    if (id === null) return
    let cancelled = false
    window.apiary
      .tree('')
      .then((nodes) => {
        if (cancelled) return
        const found = findSessionById(nodes, id)
        if (found) openSessionTab(found, false)
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
    document.body.classList.add('resizing-active')
    const onMove = (e: MouseEvent): void => {
      const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX))
      setUi((prev) => (prev.sidebarWidth === width ? prev : { ...prev, sidebarWidth: width }))
    }
    const onUp = (): void => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  // Same pattern as the sidebar resizer above, but for the bottom shell pane's height. Dragging
  // up (decreasing clientY) should grow the pane, so height is measured as the distance from the
  // cursor to the bottom of the window rather than from the top.
  useEffect(() => {
    if (!resizingBottom) return
    document.body.classList.add('resizing-active')
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
      document.body.classList.remove('resizing-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizingBottom])

  /**
   * Dragging a divider between two columns. Only the pair either side of the divider changes —
   * every other column keeps the weight it had, so dragging one boundary doesn't quietly reflow
   * the whole row. The pair's combined weight is preserved and redistributed in proportion to
   * their new pixel widths, which is what keeps the arithmetic stable across repeated drags.
   */
  useEffect(() => {
    if (columnDrag === null) return
    document.body.classList.add('resizing-active')
    const { leftId, rightId, startX, leftWidth, rightWidth } = columnDrag
    const onMove = (e: MouseEvent): void => {
      const pairWidth = leftWidth + rightWidth
      const delta = Math.max(
        MIN_COLUMN_WIDTH - leftWidth,
        Math.min(rightWidth - MIN_COLUMN_WIDTH, e.clientX - startX),
      )
      setColumnWeights((prev) => {
        const pairWeight = (prev.get(leftId) ?? 1) + (prev.get(rightId) ?? 1)
        const leftShare = (leftWidth + delta) / pairWidth
        const next = new Map(prev)
        next.set(leftId, pairWeight * leftShare)
        next.set(rightId, pairWeight * (1 - leftShare))
        return next
      })
    }
    const onUp = (): void => setColumnDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [columnDrag])

  /** Starts a divider drag, measuring both columns as they are right now. */
  const startColumnDrag = useCallback((leftId: string, rightId: string, startX: number) => {
    const widthOf = (id: string): number =>
      document.querySelector(`[data-column-id="${id}"]`)?.getBoundingClientRect().width ?? 0
    setColumnDrag({
      leftId, rightId, startX, leftWidth: widthOf(leftId), rightWidth: widthOf(rightId),
    })
  }, [])

  /**
   * The tab bar's split button: the active session moves into a column of its own beside the
   * current one, keeping whichever view (transcript or terminal) it was already on. It stays open
   * in the original column too, matching both VS Code's split and the sidebar's own split button.
   */
  const splitActiveTab = useCallback((key: string) => {
    const created = newColumn()
    setColumns((prev) => {
      const tab = prev.flatMap((c) => c.tabs).find((t) => t.key === key)
      if (tab === undefined) return prev
      return [...prev, { ...created, tabs: [{ ...tab }], activeKey: key }]
    })
    setActiveColumnId(created.id)
  }, [])

  // Records a rename typed in before this pending session had a real id yet — held in-memory
  // (see PendingSession.titleOverride) until the reconciliation effect above can apply it.
  const setPendingTitle = useCallback((ptyId: string, title: string) => {
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
    void window.apiary.tree('').then((nodes) => {
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
        window.apiary.tree(''),
      ])
      addPending(info, nodes)
    } catch (e) {
      notifyError(e, 'Could not start a new session')
    }
  }, [addPending, notifyError])

  const startResume = useCallback(async (session: SessionNode, fork: boolean) => {
    try {
      await window.apiary.resume(session.sessionId, fork)
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
    await startResume(session, false)
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
    await window.apiary.resume(session.sessionId, false)
    setResumed((prev) => new Set([...prev, session.sessionId]))
    setColumns((prev) => prev.map((c) => setTabView(c, session.sessionId, 'terminal')))
  }, [resumed, setColumns])

  /** Every session id currently open in some column, so the sidebar can list only the pending
   *  sessions that aren't already reachable as a tab. */
  const openKeys = new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))

  const pendingTabInfo = new Map(
    [...pending.values()].map((info) => [
      info.ptyId,
      { ptyId: info.ptyId, cwd: info.cwd, label: info.titleOverride ?? info.label },
    ]),
  )

  return (
    <div
      className="layout"
      style={{ gridTemplateColumns: String(ui.sidebarWidth) + 'px 4px 1fr' }}
    >
      <Sidebar
        key={treeNonce}
        selectedId={activeKey}
        onSelect={onSelect}
        onSplitSession={onSplitSession}
        collapsed={new Set(ui.collapsed)}
        onCollapsedChange={setCollapsed}
        onNewSession={(path) => { void onNewSession(path) }}
        onDeleteSession={setDeleteTarget}
        pinned={ui.pinned}
        onTogglePin={togglePin}
        pinnedCollapsed={ui.pinnedCollapsed}
        onPinnedCollapsedChange={(next) => setUi((prev) => ({ ...prev, pinnedCollapsed: next }))}
        pending={[...pending.values()]
          .filter((p) => !openKeys.has(p.ptyId))
          .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd }))}
        onSelectPending={(ptyId) => {
          setColumns((prev) => {
            const targetId = prev.some((c) => c.id === activeColumnId) ? activeColumnId : prev[0]?.id
            return prev.map((c) => (c.id === targetId ? openTab(c, ptyId) : c))
          })
        }}
      />

      <div
        className="sidebar-resizer"
        data-testid="sidebar-resizer"
        onMouseDown={(e) => { e.preventDefault(); setResizing(true) }}
      />

      <main className="content" data-testid="content">
        {columns.map((column, index) => (
          <Fragment key={column.id}>
          {index > 0 && (
            <div
              className="column-resizer"
              data-testid="column-resizer"
              onMouseDown={(e) => {
                e.preventDefault()
                startColumnDrag(columns[index - 1].id, column.id, e.clientX)
              }}
            />
          )}
          {/* Per column, not just once around the whole app: a column whose session renders badly
            * (a transcript with something unexpected in it, say) should fail inside its own pane
            * and leave the sidebar and the other columns working, rather than blanking the window. */}
          <ErrorBoundary
            label="This session"
            onError={(thrown, componentStack) => {
              const { message, detail } = describeError(thrown)
              notify({
                kind: 'error',
                message: `This session could not be displayed: ${message}`,
                detail: [detail, componentStack].filter((t) => t !== null && t !== '').join('\n'),
              })
            }}
          >
          <SessionColumn
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
            weight={columnWeights.get(column.id) ?? 1}
          />
          </ErrorBoundary>
          </Fragment>
        ))}
      </main>

      {conflict !== null && resumeTarget !== null && (
        <ConflictDialog
          conflict={conflict}
          onCancel={() => { setConflict(null); setResumeTarget(null) }}
          onFork={() => { setConflict(null); setResumeTarget(null); void startResume(resumeTarget, true) }}
          onOpenAnyway={() => { setConflict(null); setResumeTarget(null); void startResume(resumeTarget, false) }}
        />
      )}

      {deleteTarget !== null && (
        <DeleteSessionDialog
          title={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => { void confirmDelete() }}
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

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
