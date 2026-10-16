import { type JSX, useEffect, useMemo, useState } from 'react'
import type { DiscoveredSession } from '@shared/api'
import { useNotifications } from '../../ui/notifications'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { ImportGroup } from './ImportGroup'
import { useImportResize } from './useImportResize'
import { useImportSelection } from './useImportSelection'
import { importSessions, listDiscoveredSessions } from '../../state/sessions'
import { bestEffort } from '../../state/policy'
import { readSettings } from '../../state/settingsStore'

interface Props {
  onClose: () => void
  onImported: () => void
  /** Persisted dialog width — session titles run long, so this one is draggable. */
  width: number
  onWidthChange: (next: number) => void
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
  const { notifyError } = useNotifications()
  const [rows, setRows] = useState<DiscoveredSession[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  /* Folder paths the user has collapsed; absent = expanded, so a new folder starts open.
   * Ticking a collapsed folder's checkbox still selects everything inside it. */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleCollapsed = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  useEffect(() => {
    // A toast, not an empty list that would read as "there is nothing to import".
    void listDiscoveredSessions().then(setRows).catch((e: unknown) => {
      notifyError(e, 'Could not list sessions to import')
    })
  }, [notifyError])

  /** When "import everything automatically" is on there is nothing to choose, and the dialog says so. */
  const [autoImportAll, setAutoImportAll] = useState(false)
  useEffect(() => {
    // A failed read leaves the default (false): the ordinary per-row checkboxes.
    void bestEffort(readSettings(), 'settings').then((s) => { if (s !== null) setAutoImportAll(s.autoImportAll) })
  }, [])

  const { leftEdge, rightEdge } = useImportResize(width, onWidthChange)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || r.projectPath.toLowerCase().includes(q),
    )
  }, [rows, query])

  const groups = useMemo(() => groupByProject(filtered), [filtered])

  const { picked, autoProjects, toggleSession, toggleGroup, allSelectable, allSelected, toggleAll } = useImportSelection(filtered)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await importSessions([...picked], [...autoProjects])
      onImported()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="import-dialog" titleId="import-dialog-title" onClose={onClose} wide className="import-dialog" style={{ width: `var(--drag-import-width, ${String(width)}px)` }}>
        {/* Edges, not tab stops: only the pointer half of the separator. */}
        <div className="dialog-resizer dialog-resizer-left" data-testid="import-resizer-left" onPointerDown={leftEdge.separatorProps.onPointerDown} />
        <div className="dialog-resizer dialog-resizer-right" data-testid="import-resizer-right" onPointerDown={rightEdge.separatorProps.onPointerDown} />
        <h2 id="import-dialog-title">Import Claude Sessions</h2>
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
          {[...groups.entries()].map(([path, sessions]) => (
            <ImportGroup
              key={path}
              path={path}
              sessions={sessions}
              picked={picked}
              collapsed={collapsed.has(path)}
              onToggleCollapsed={() => { toggleCollapsed(path) }}
              onToggleGroup={(on) => { toggleGroup(path, sessions, on) }}
              onToggleSession={toggleSession}
            />
          ))}

          {groups.size === 0 && <p className="empty">No sessions found.</p>}
        </div>

        <div className="modal-actions">
          <span className="muted" data-testid="import-count">{picked.size} selected</span>
          <button className="btn" data-testid="import-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            data-testid="import-confirm"
            disabled={busy}
            onClick={() => { void confirm() }}
          >
            Import
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
