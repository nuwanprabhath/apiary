import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DiscoveredSession } from '@shared/api'

const MIN_DIALOG_WIDTH = 420
const MAX_DIALOG_WIDTH = 1500

interface Props {
  onClose: () => void
  onImported: () => void
  /** Persisted dialog width — session titles run long, so this one is draggable. */
  width: number
  onWidthChange: (next: number) => void
}

/**
 * What the hover tooltip says about a row: its full title (the visible one is ellipsized to fit)
 * and how long ago it was last touched, in both the relative form you actually think in and the
 * absolute one you need when comparing two of them.
 */
function describeSession(s: DiscoveredSession): string {
  if (s.lastActiveAtMs === null) return s.title
  const when = new Date(s.lastActiveAtMs)
  const days = Math.floor((Date.now() - s.lastActiveAtMs) / 86400000)
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${String(days)} days ago`
  return `${s.title}\n\nLast active ${ago} — ${when.toLocaleString()}`
}

function groupByProject(rows: DiscoveredSession[]): Map<string, DiscoveredSession[]> {
  const groups = new Map<string, DiscoveredSession[]>()
  for (const row of rows) {
    const list = groups.get(row.projectPath) ?? []
    list.push(row)
    groups.set(row.projectPath, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0))
  }
  return groups
}

export function ImportDialog({ onClose, onImported, width, onWidthChange }: Props): JSX.Element {
  const [rows, setRows] = useState<DiscoveredSession[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [autoProjects, setAutoProjects] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  /* Folder paths the user has collapsed. Absent = expanded, so a folder that appears later (or
   * after the search filter changes) starts open, with no separate "seen before" bookkeeping —
   * the sidebar tracks its own collapsed folders the same way. Ticking a collapsed folder's
   * checkbox still selects everything inside it; collapsing only hides rows. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleCollapsed = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  useEffect(() => {
    void window.apiary.discovered().then(setRows)
  }, [])

  /**
   * Whether the "import everything automatically" setting is on. When it is, this dialog has
   * nothing left to decide — everything is already imported, or is about to be — so it says so
   * rather than presenting a list of ticked, disabled rows with no explanation for why.
   */
  const [autoImportAll, setAutoImportAll] = useState(false)
  useEffect(() => {
    void window.apiary.settingsGet().then((s) => setAutoImportAll(s.autoImportAll))
  }, [])

  /** Escape dismisses the dialog, the same way it dismisses the branch picker and the git menu. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  /**
   * Dragging either edge widens the dialog. The dialog is centred, so a drag has to move the width
   * by twice the pointer's travel for the edge under the cursor to actually keep up with it —
   * otherwise the edge slides away at half speed and the drag feels broken.
   */
  const [dragFrom, setDragFrom] = useState<{ x: number; width: number; side: 1 | -1 } | null>(null)
  useEffect(() => {
    if (dragFrom === null) return
    document.body.classList.add('resizing-active')
    const onMove = (e: MouseEvent): void => {
      const next = dragFrom.width + (e.clientX - dragFrom.x) * 2 * dragFrom.side
      onWidthChange(Math.round(Math.max(MIN_DIALOG_WIDTH, Math.min(MAX_DIALOG_WIDTH, next))))
    }
    const onUp = (): void => setDragFrom(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragFrom, onWidthChange])

  const startDrag = useCallback((side: 1 | -1) => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragFrom({ x: e.clientX, width, side })
  }, [width])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || r.projectPath.toLowerCase().includes(q),
    )
  }, [rows, query])

  const groups = useMemo(() => groupByProject(filtered), [filtered])

  const toggleSession = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  /** Ticking a folder selects its sessions and marks it for auto-import of future ones. */
  const toggleGroup = (path: string, sessions: DiscoveredSession[], on: boolean): void => {
    const nextPicked = new Set(picked)
    const nextAuto = new Set(autoProjects)
    for (const s of sessions) {
      if (s.imported) continue
      if (on) nextPicked.add(s.sessionId)
      else nextPicked.delete(s.sessionId)
    }
    if (on) nextAuto.add(path)
    else nextAuto.delete(path)
    setPicked(nextPicked)
    setAutoProjects(nextAuto)
  }

  /**
   * Every session the dialog is currently showing that isn't already imported. Scoped to the
   * filtered list on purpose: with a search term typed in, "select all" means all of *these*,
   * which is the only reading that isn't a nasty surprise.
   */
  const allSelectable = useMemo(() => filtered.filter((r) => !r.imported), [filtered])
  const allSelected = allSelectable.length > 0 && allSelectable.every((r) => picked.has(r.sessionId))

  const toggleAll = (on: boolean): void => {
    const next = new Set(picked)
    for (const r of allSelectable) {
      if (on) next.add(r.sessionId)
      else next.delete(r.sessionId)
    }
    setPicked(next)
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.apiary.importSessions([...picked], [...autoProjects])
      onImported()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal wide import-dialog"
        data-testid="import-dialog"
        role="dialog"
        aria-modal="true"
        style={{ width }}
      >
        <div className="dialog-resizer dialog-resizer-left" data-testid="import-resizer-left" onMouseDown={startDrag(-1)} />
        <div className="dialog-resizer dialog-resizer-right" data-testid="import-resizer-right" onMouseDown={startDrag(1)} />
        <h2>Import Claude Sessions</h2>
        <input
          className="search"
          data-testid="import-search"
          placeholder="Search sessions or folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {autoImportAll && (
          <p className="import-auto-notice" data-testid="import-auto-notice">
            Every session is being imported automatically (Settings &gt; Sessions), so there is
            nothing to choose here. Turn that off to pick sessions by hand again.
          </p>
        )}

        <label className="import-select-all">
          <input
            type="checkbox"
            data-testid="import-select-all"
            checked={allSelected}
            disabled={allSelectable.length === 0}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span>
            Select every session listed
            {allSelectable.length > 0 && <span className="muted"> ({allSelectable.length} not yet imported)</span>}
          </span>
        </label>

        <div className="import-list">
          {[...groups.entries()].map(([path, sessions]) => {
            const selectable = sessions.filter((s) => !s.imported)
            // "In" means the session will be in the sidebar once this dialog is confirmed —
            // whether it was already imported on a previous visit or has just been ticked here.
            // Counting only the freshly-ticked ones is what used to leave a folder whose every
            // session was already imported showing an *unchecked* header, which reads as "none of
            // this folder is imported" when in fact all of it is.
            const isIn = (s: DiscoveredSession): boolean => s.imported || picked.has(s.sessionId)
            const allPicked = sessions.length > 0 && sessions.every(isIn)
            // Some but not all: the header shows the tri-state dash rather than claiming either.
            const somePicked = !allPicked && sessions.some(isIn)
            return (
              <section key={path} data-testid="import-group">
                {/* The chevron is a sibling of the label rather than inside it: a <label> forwards
                 *  every click within it to its own control, so a nested collapse button would
                 *  toggle the folder's checkbox on the way past. Same reason the sidebar's row
                 *  buttons sit beside their row rather than inside it. */}
                <div className="import-group-head">
                  <button
                    className="import-group-toggle"
                    data-testid="import-group-toggle"
                    aria-expanded={!collapsed.has(path)}
                    title={collapsed.has(path) ? 'Expand folder' : 'Collapse folder'}
                    onClick={() => toggleCollapsed(path)}
                  >
                    <svg
                      className="chevron"
                      data-expanded={!collapsed.has(path)}
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <label className="import-group-label">
                    <input
                      type="checkbox"
                      data-testid="import-group-checkbox"
                      checked={allPicked}
                      // `indeterminate` is a DOM property with no HTML attribute behind it, so it
                      // can only be set through the element itself, not through JSX.
                      ref={(el) => { if (el !== null) el.indeterminate = somePicked }}
                      disabled={selectable.length === 0}
                      onChange={(e) => toggleGroup(path, sessions, e.target.checked)}
                    />
                    <span className="project-label">{path}</span>
                    <span className="muted">{sessions.length}</span>
                  </label>
                </div>

                {!collapsed.has(path) && sessions.map((s) => (
                  <label key={s.sessionId} className="import-row" title={describeSession(s)}>
                    <input
                      type="checkbox"
                      data-testid="import-session-checkbox"
                      checked={s.imported || picked.has(s.sessionId)}
                      disabled={s.imported}
                      onChange={() => toggleSession(s.sessionId)}
                    />
                    <span className="session-title">{s.title}</span>
                    {s.imported && <span className="muted">already imported</span>}
                  </label>
                ))}
              </section>
            )
          })}

          {groups.size === 0 && <p className="empty">No sessions found.</p>}
        </div>

        <div className="modal-actions">
          <span className="muted" data-testid="import-count">{picked.size} selected</span>
          <button data-testid="import-cancel" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="import-confirm"
            disabled={busy}
            onClick={() => { void confirm() }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
