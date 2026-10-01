import { type JSX, useMemo } from 'react'
import type { SessionNode } from '@shared/types'
import { useFlatTreeNav } from '../../ui/Tree'
import { SectionHeader } from './SectionHeader'
import { SessionRow } from './SessionRow'
import type { RowActions } from './rowActions'

/**
 * Pinned rows, in the order they were pinned rather than the order the tree happens to hold them.
 * UI-27: its own flat tree — a manually curated shortlist, not part of the folder hierarchy any
 * more than Active or Recent are.
 */
export function PinnedSection({
  sessions, selectedId, folderBranches, collapsed, onCollapsedChange, onReorderPinned, actions,
}: {
  sessions: SessionNode[]
  selectedId: string | null
  folderBranches: Map<string, string | null>
  collapsed: boolean
  onCollapsedChange: (next: boolean) => void
  /** Reorders the section by dropping one pinned session onto another. */
  onReorderPinned: (id: string, beforeId: string) => void
  actions: RowActions
}): JSX.Element {
  const byId = useMemo(() => new Map(sessions.map((s): [string, typeof s] => [s.sessionId, s])), [sessions])
  const tree = useFlatTreeNav(sessions.map((s) => s.sessionId), {
    onEnter: (current) => {
      const s = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onSelect(s)
    },
    onShiftEnter: (current) => {
      const s = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onSplit(s)
    },
    onContextMenuKey: (current, at) => {
      const s = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onMenu(s, at.x, at.y)
    },
  })
  return (
    <section className="pinned-section" data-testid="pinned-section">
      <SectionHeader
        testId="pinned-toggle"
        label="Pinned"
        count={sessions.length}
        expanded={!collapsed}
        onToggle={() => onCollapsedChange(!collapsed)}
      />
      {!collapsed && (
      <div role="tree" aria-label="Pinned sessions" ref={tree.ref} onKeyDown={tree.onKeyDown} onFocus={tree.onFocus}>
      {sessions.map((s) => (
        <div
          key={s.sessionId}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('application/x-apiary-pinned', s.sessionId)
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-apiary-pinned')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            const dragged = e.dataTransfer.getData('application/x-apiary-pinned')
            if (dragged === '' || dragged === s.sessionId) return
            e.preventDefault()
            onReorderPinned(dragged, s.sessionId)
          }}
        >
          <SessionRow
            session={s}
            selected={s.sessionId === selectedId}
            pinned
            {...actions}
            folderBranch={folderBranches.get(s.sessionId) ?? null}
            treeTabIndex={tree.tabIndexFor(s.sessionId)}
          />
        </div>
      ))}
      </div>
      )}
    </section>
  )
}
