import { useEffect, useMemo, useState } from 'react'
import type { DiscoveredSession } from '@shared/api'

interface Props {
  onClose: () => void
  onImported: () => void
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

export function ImportDialog({ onClose, onImported }: Props): JSX.Element {
  const [rows, setRows] = useState<DiscoveredSession[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [autoProjects, setAutoProjects] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.apiary.discovered().then(setRows)
  }, [])

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
      <div className="modal wide" data-testid="import-dialog" role="dialog" aria-modal="true">
        <h2>Import Claude Sessions</h2>
        <input
          className="search"
          data-testid="import-search"
          placeholder="Search sessions or folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="import-list">
          {[...groups.entries()].map(([path, sessions]) => {
            const selectable = sessions.filter((s) => !s.imported)
            const allPicked =
              selectable.length > 0 && selectable.every((s) => picked.has(s.sessionId))
            return (
              <section key={path} data-testid="import-group">
                <label className="import-group-head">
                  <input
                    type="checkbox"
                    data-testid="import-group-checkbox"
                    checked={allPicked}
                    disabled={selectable.length === 0}
                    onChange={(e) => toggleGroup(path, sessions, e.target.checked)}
                  />
                  <span className="project-label">{path}</span>
                  <span className="muted">{sessions.length}</span>
                </label>

                {sessions.map((s) => (
                  <label key={s.sessionId} className="import-row">
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
