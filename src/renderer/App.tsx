import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewSessionInfo, ProjectNode, ResumeConflict, SessionNode } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { EditableSessionTitle } from './components/EditableSessionTitle'
import { Transcript } from './components/Transcript'
import { TerminalView } from './components/TerminalView'
import { ResumeBar } from './components/ResumeBar'
import { ConflictDialog } from './components/ConflictDialog'
import { DeleteSessionDialog } from './components/DeleteSessionDialog'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { loadUiState, saveUiState, type UiState } from './state/uiState'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 600

// Floor keeps the toggle bar plus a few rows of terminal usable; ceiling leaves the transcript
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
  const [ui, setUi] = useState<UiState>(() => loadUiState())
  const [selected, setSelected] = useState<SessionNode | null>(null)
  const [view, setView] = useState<'transcript' | 'terminal'>('transcript')
  const [resumed, setResumed] = useState<Set<string>>(new Set())
  // Sessions started via newSessionInProject()/newSessionInFolder() whose pty id differs from
  // the session's own id (a "new:<uuid>" id, minted before the session had one). Consulted by
  // TerminalView's ptyId prop so the terminal that was actually spawned keeps being addressed
  // once the real SessionNode appears, instead of a second pty being spawned under the id.
  // Also doubles as the cross-tick "already claimed" record the reconciler below consults so two
  // pending sessions in the same folder can never be folded into the same discovered SessionNode.
  const [ptyOverrides, setPtyOverrides] = useState<Map<string, string>>(new Map())
  // Every new-session pty currently awaiting its first JSONL, keyed by pty id (not a single
  // value) so more than one can be in flight — see PendingSession above and Finding 1.
  const [pending, setPending] = useState<Map<string, PendingSession>>(new Map())
  // Which pending pty (if any) is the one shown in the main pane while nothing is selected. Only
  // the most-recently-started pending session is ever displayed; older ones keep reconciling in
  // the background (bookkeeping only) until they resolve into a real session or their pty exits.
  const [visiblePendingId, setVisiblePendingId] = useState<string | null>(null)
  const [shellOpen, setShellOpen] = useState(false)
  const [shells, setShells] = useState<Set<string>>(new Set())
  const [conflict, setConflict] = useState<ResumeConflict | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [treeNonce, setTreeNonce] = useState(0)
  const [resizing, setResizing] = useState(false)
  const [resizingBottom, setResizingBottom] = useState(false)

  // Mirrors `selected` for the pending-session watcher below, which needs to know synchronously
  // whether the user is still looking at "nothing selected" (i.e. still on the pending terminal)
  // without taking a stale closure over `selected` from the render that scheduled the effect.
  const selectedRef = useRef<SessionNode | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // Mirrors `visiblePendingId` for the same reason — the reconciliation effect below needs the
  // current value, not the one captured when its closure was created.
  const visiblePendingRef = useRef<string | null>(null)
  useEffect(() => { visiblePendingRef.current = visiblePendingId }, [visiblePendingId])

  useEffect(() => { saveUiState(ui) }, [ui])
  useEffect(() => window.apiary.onOpenImportDialog(() => setImportOpen(true)), [])
  useEffect(() => window.apiary.onOpenSettingsDialog(() => setSettingsOpen(true)), [])

  // Registers a freshly-started new session as pending and makes it the visible one — shared by
  // both entry points (the sidebar "+" button and the File menu item below).
  const addPending = useCallback((info: NewSessionInfo, nodes: ProjectNode[]) => {
    setSelected(null)
    setPending((prev) => {
      const next = new Map(prev)
      next.set(info.ptyId, { ...info, knownSessionIds: collectSessionIds(nodes), titleOverride: null })
      return next
    })
    setVisiblePendingId(info.ptyId)
    setError(null)
  }, [])

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
    setVisiblePendingId((prev) => (prev === id ? null : prev))
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
            void window.apiary.renameSession(found.sessionId, info.titleOverride).catch((e: Error) => {
              setError(e.message)
            })
          }
          // Only take over the current view if the user is still looking at this pending
          // session's terminal — a user who already navigated elsewhere (or is looking at a
          // different pending session) is left alone; the bookkeeping above still ensures
          // selecting the new session later reuses this pty rather than spawning a second one.
          if (selectedRef.current === null && ptyId === visiblePendingRef.current) {
            setSelected(resolved)
            setView('terminal')
            setUi((prevUi) => ({ ...prevUi, selectedSessionId: found.sessionId }))
          }
          if (ptyId === visiblePendingRef.current) setVisiblePendingId(null)
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
  }, [pending, ptyOverrides])

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
        if (found) {
          setSelected(found)
          setView('transcript')
        }
      })
      .catch(() => {
        // Restoring selection is best-effort; a failed lookup just leaves nothing selected.
      })
    return () => { cancelled = true }
    // Intentionally runs once on mount only, against the id loaded at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const setCollapsed = useCallback((next: Set<string>) => {
    setUi((prev) => {
      const list = [...next].sort()
      if (list.join(' ') === [...prev.collapsed].sort().join(' ')) return prev
      return { ...prev, collapsed: list }
    })
  }, [])

  const onSelect = useCallback((session: SessionNode) => {
    setSelected(session)
    setView('transcript')
    setUi((prev) => ({ ...prev, selectedSessionId: session.sessionId }))
  }, [])

  // The sidebar "+" button. `path` is a project's stable identity (ProjectNode.path); the main
  // process re-validates it against a stored project row before spawning anything with it.
  const onNewSession = useCallback(async (path: string) => {
    try {
      const [info, nodes] = await Promise.all([
        window.apiary.newSessionInProject(path),
        window.apiary.tree(''),
      ])
      addPending(info, nodes)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [addPending])

  const startResume = useCallback(async (session: SessionNode, fork: boolean) => {
    try {
      await window.apiary.resume(session.sessionId, fork)
      setResumed((prev) => new Set([...prev, session.sessionId]))
      setView('terminal')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await window.apiary.removeSession(target.sessionId)
      // Deleting the currently-selected session leaves nothing sensible to show — clear the
      // selection rather than leaving a stale header pointed at a session no longer in the tree.
      setSelected((prev) => (prev !== null && prev.sessionId === target.sessionId ? null : prev))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [deleteTarget])

  const onResume = useCallback(async () => {
    if (selected === null) return
    if (resumed.has(selected.sessionId)) { setView('terminal'); return }
    const existing = await window.apiary.checkConflict(selected.sessionId)
    if (existing !== null) { setConflict(existing); return }
    await startResume(selected, false)
  }, [selected, resumed, startResume])

  // The pending session currently shown in the main pane, if any — null once a real session is
  // selected, even if other pending sessions are still resolving in the background.
  const visiblePending =
    selected === null && visiblePendingId !== null ? pending.get(visiblePendingId) ?? null : null

  // A shell can be opened alongside either a resumed session or a still-pending new session —
  // `shellKey` is whichever one is currently showing, used both as the `shells`/bottom-pane
  // bookkeeping key and as the suffix of the `shell:<key>` pty id. Pending sessions have no real
  // session id yet, so they're keyed by pty id instead; the two id spaces never collide (session
  // ids are bare UUIDs, pty ids for a new session are `new:<uuid>`). Once a pending session
  // reconciles into a real one, `ptyOverrides` — the same map `activePtyId` below consults for
  // the main terminal — is consulted here too, so a shell opened during the pending phase keeps
  // being addressed by its original `shell:<ptyId>` id instead of orphaning it in favour of a
  // second shell freshly spawned under `shell:<sessionId>`.
  const shellKey =
    visiblePending !== null
      ? visiblePending.ptyId
      : selected !== null
        ? ptyOverrides.get(selected.sessionId) ?? selected.sessionId
        : null

  // Whether the running claude process behind the current selection is actually keyed by
  // `shellKey` itself in the main process, or was spawned as a "new session" pty and is only
  // *addressed* as `shellKey` here via `ptyOverrides` (see the comment on `shellKey` above). The
  // former is a real session id `openShell` can look up in the store; the latter is a pty id only
  // `PtyManager` knows about, so it must go through `openShellForPty` instead — calling `openShell`
  // with a pty id would fail the store lookup that call relies on for its cwd.
  const shellKeyIsPtyId =
    visiblePending !== null || (selected !== null && ptyOverrides.has(selected.sessionId))

  const toggleShell = useCallback(async () => {
    if (shellKey === null) return
    if (shellOpen) { setShellOpen(false); return }
    if (!shells.has(shellKey)) {
      try {
        if (shellKeyIsPtyId) {
          await window.apiary.openShellForPty(shellKey)
        } else {
          await window.apiary.openShell(shellKey)
        }
        setShells((prev) => new Set([...prev, shellKey]))
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setShellOpen(true)
  }, [shellKey, shellKeyIsPtyId, shellOpen, shells])

  // The pty id backing the terminal pane, and whether that pane should be mounted at all. Both
  // the pending branch and the resumed-session branch below render this same TerminalView at the
  // same position in the tree (only its `hidden` state and — across the pending-to-resolved
  // transition — its props change), so React never unmounts/remounts it and scrollback survives
  // reconciliation. See Finding 2.
  const activePtyId =
    visiblePending !== null
      ? visiblePending.ptyId
      : selected !== null
        ? ptyOverrides.get(selected.sessionId) ?? selected.sessionId
        : null
  const showTerminalPane =
    visiblePending !== null || (selected !== null && resumed.has(selected.sessionId))

  return (
    <div
      className="layout"
      style={{ gridTemplateColumns: String(ui.sidebarWidth) + 'px 4px 1fr' }}
    >
      <Sidebar
        key={treeNonce}
        selectedId={selected?.sessionId ?? null}
        onSelect={onSelect}
        collapsed={new Set(ui.collapsed)}
        onCollapsedChange={setCollapsed}
        onNewSession={(path) => { void onNewSession(path) }}
        onDeleteSession={setDeleteTarget}
        pending={[...pending.values()]
          .filter((p) => p.ptyId !== visiblePendingId)
          .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd }))}
        onSelectPending={(ptyId) => { setSelected(null); setVisiblePendingId(ptyId) }}
      />

      <div
        className="sidebar-resizer"
        data-testid="sidebar-resizer"
        onMouseDown={(e) => { e.preventDefault(); setResizing(true) }}
      />

      <main className="content" data-testid="content">
        {visiblePending === null && selected === null ? (
          <p className="empty" data-testid="content-empty">
            Select a session to view its transcript.
          </p>
        ) : (
          <>
            <header className="session-header">
              <h1 data-testid="session-title" className="session-title-heading">
                {visiblePending !== null ? (
                  <>
                    New session &middot;{' '}
                    <EditableSessionTitle
                      key={visiblePending.ptyId}
                      title={visiblePending.titleOverride ?? visiblePending.label}
                      onRename={(title) => setPendingTitle(visiblePending.ptyId, title)}
                    />
                  </>
                ) : selected !== null ? (
                  <EditableSessionTitle
                    key={selected.sessionId}
                    title={selected.title}
                    onRename={(title) => {
                      setSelected((prev) => (prev === null ? prev : { ...prev, title }))
                      void window.apiary.renameSession(selected.sessionId, title).catch((e: Error) => {
                        setError(e.message)
                      })
                    }}
                  />
                ) : null}
              </h1>
              <p className="session-cwd">{visiblePending !== null ? visiblePending.cwd : selected?.cwd}</p>
            </header>

            {visiblePending === null && selected !== null && (
              <ResumeBar
                session={selected}
                view={view}
                hasTerminal={resumed.has(selected.sessionId)}
                onView={setView}
                onResume={() => { void onResume() }}
              />
            )}

            {error !== null && <p className="error-banner" data-testid="error-banner">{error}</p>}

            <div className="centre-pane">
              {visiblePending === null && selected !== null && (
                <div hidden={view !== 'transcript'} className="pane-fill">
                  <Transcript session={selected} />
                </div>
              )}
              {showTerminalPane && activePtyId !== null && (
                <div hidden={visiblePending === null && view !== 'terminal'} className="pane-fill">
                  <TerminalView ptyId={activePtyId} testId="terminal-session" />
                </div>
              )}
            </div>

            {shellKey !== null && shellOpen && (
              <div
                className="bottom-resizer"
                data-testid="bottom-resizer"
                onMouseDown={(e) => { e.preventDefault(); setResizingBottom(true) }}
              />
            )}

            {shellKey !== null && (
              <div className="bottom-pane" style={{ height: shellOpen ? ui.bottomHeight : 32 }}>
                <button className="shell-toggle" data-testid="shell-toggle" onClick={() => { void toggleShell() }}>
                  {shellOpen ? 'Hide shell' : 'Show shell'}
                </button>
                {shellOpen && shells.has(shellKey) && (
                  <TerminalView ptyId={'shell:' + shellKey} testId="terminal-shell" />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {conflict !== null && selected !== null && (
        <ConflictDialog
          conflict={conflict}
          onCancel={() => setConflict(null)}
          onFork={() => { setConflict(null); void startResume(selected, true) }}
          onOpenAnyway={() => { setConflict(null); void startResume(selected, false) }}
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
        />
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
