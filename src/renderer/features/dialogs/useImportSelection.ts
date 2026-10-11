import { useMemo, useState } from 'react'
import type { DiscoveredSession } from '@shared/api'
import type { SessionId } from '@shared/domain/ids'

/** What the import dialog has ticked: sessions, and the folders marked for auto-import. */
export function useImportSelection(filtered: DiscoveredSession[]) {
  const [picked, setPicked] = useState<Set<SessionId>>(() => new Set())
  const [autoProjects, setAutoProjects] = useState<Set<string>>(() => new Set())

  const toggleSession = (id: SessionId): void => {
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

  return { picked, autoProjects, toggleSession, toggleGroup, allSelectable, allSelected, toggleAll }
}
