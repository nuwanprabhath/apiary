import { type JSX, useMemo } from 'react'
import type { SessionNode } from '@shared/types'
import type { RankedSession } from '@shared/sessionRank'
import { useFlatTreeNav } from '../../ui/Tree'
import { SessionRow } from './SessionRow'
import type { RowActions } from './rowActions'

/** The flat, ranked results shown while searching. UI-27: its own flat tree — a ranked search
 *  result is not a folder listing. */
export function SearchResults({ results, selectedId, pinned, actions }: {
  results: RankedSession[]
  selectedId: string | null
  pinned: Set<string>
  actions: RowActions
}): JSX.Element {
  const byId = useMemo(() => new Map(results.map(({ session }): [string, typeof session] => [session.sessionId, session])), [results])
  const tree = useFlatTreeNav<HTMLUListElement>(results.map(({ session }) => session.sessionId), {
    onEnter: (current) => {
      const s = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onSelect(s)
    },
    onShiftEnter: (current) => {
      const s = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onSplit(s)
    },
    onContextMenuKey: (current, at) => {
      const s: SessionNode | undefined = current.dataset.treeKey === undefined ? undefined : byId.get(current.dataset.treeKey)
      if (s !== undefined) actions.onMenu(s, at.x, at.y)
    },
  })
  return (
    <ul
      className="tree flat-results"
      data-testid="flat-results"
      role="tree"
      aria-label="Search results"
      ref={tree.ref}
      onKeyDown={tree.onKeyDown}
      onFocus={tree.onFocus}
    >
      {results.map(({ session, worktreeLabel }) => (
        <li key={session.sessionId}>
          <SessionRow
            session={session}
            selected={session.sessionId === selectedId}
            pinned={pinned.has(session.sessionId)}
            {...actions}
            subtitle={worktreeLabel}
            treeTabIndex={tree.tabIndexFor(session.sessionId)}
          />
        </li>
      ))}
    </ul>
  )
}
