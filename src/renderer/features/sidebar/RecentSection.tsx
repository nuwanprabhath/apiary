import { type JSX, useMemo } from 'react'
import type { SessionNode } from '@shared/types'
import { useFlatTreeNav } from '../../ui/Tree'
import { SectionHeader } from './SectionHeader'
import { SessionRow } from './SessionRow'
import type { RowActions } from './rowActions'

/** Recently used sessions, resolved against the same filtered tree Pinned is. UI-27: its own flat
 *  tree — time-ordered, not part of the folder hierarchy. */
export function RecentSection({
  sessions, selectedId, folderBranches, collapsed, onCollapsedChange, onDismiss, actions,
}: {
  sessions: SessionNode[]
  selectedId: string | null
  folderBranches: Map<string, string | null>
  collapsed: boolean
  onCollapsedChange: (next: boolean) => void
  /** Hides a session from Recent until it is used again. */
  onDismiss: (session: SessionNode) => void
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
    <section className="recent-section" data-testid="recent-section">
      <SectionHeader
        testId="recent-toggle"
        label="Recent"
        count={sessions.length}
        expanded={!collapsed}
        onToggle={() => onCollapsedChange(!collapsed)}
      />
      {!collapsed && (
      <div role="tree" aria-label="Recent sessions" ref={tree.ref} onKeyDown={tree.onKeyDown} onFocus={tree.onFocus}>
      {sessions.map((s) => (
        <div key={s.sessionId} className="recent-row-wrap">
          <SessionRow
            session={s}
            selected={s.sessionId === selectedId}
            pinned={false}
            {...actions}
            folderBranch={folderBranches.get(s.sessionId) ?? null}
            onDismiss={onDismiss}
            treeTabIndex={tree.tabIndexFor(s.sessionId)}
          />
        </div>
      ))}
      </div>
      )}
    </section>
  )
}
