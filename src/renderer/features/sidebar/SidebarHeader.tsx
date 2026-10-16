import { type JSX, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { RefreshIcon, SidebarIcon } from '../../ui/icons'
import { useNotifications } from '../../ui/notifications'
import { countSessions } from '@shared/treeWalk'
import { describeRefresh } from './model/refreshSummary'
import { SearchField } from './SearchField'
import { rescanSessions } from '../../state/sessions'

/** The sidebar's top row: hide, the search box and Refresh. */
export function SidebarHeader({
  onHide, hideTitle, onQuery, deferredQuery, tree, reload, reloadNow, onRefreshed,
}: {
  onHide?: () => void
  /** The hide button's tooltip, which names the platform's shortcut. */
  hideTitle: string
  onQuery: (query: string) => void
  /** The query the rows below actually correspond to. */
  deferredQuery: string
  tree: ProjectNode[]
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
  /** The rescan finished: worktrees on disk may have changed too. */
  onRefreshed: () => void
}): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const [refreshing, setRefreshing] = useState(false)
  return (
    <div className="sidebar-header">
      {onHide !== undefined && (
        // First in the row, where the rail's button that brings it back will be.
        <button
          className="icon-button sidebar-hide"
          data-testid="sidebar-hide"
          title={hideTitle}
          aria-label="Hide sidebar"
          onClick={onHide}
        >
          <SidebarIcon />
        </button>
      )}
      {/* Owns the typed text itself, so a keystroke re-renders the box and nothing else — see
       *  SearchField. `resultsFor` is the query the rows below actually correspond to, which is
       *  what tells the field whether it is still catching up. */}
      <SearchField onChange={onQuery} resultsFor={deferredQuery} />
      <button
        className="icon-button sidebar-refresh"
        data-testid="sidebar-refresh"
        data-refreshing={refreshing}
        disabled={refreshing}
        onClick={() => {
          // What the list holds before the rescan, so the notification can say what it found.
          const before = countSessions(tree)
          setRefreshing(true)
          void rescanSessions()
            .then(reloadNow)
            .then((next) => {
              onRefreshed()
              notify({ message: describeRefresh(before, countSessions(next), deferredQuery.trim() !== '') })
            })
            .catch((e: unknown) => { reload(); notifyError(e, 'Could not rescan sessions') })
            .finally(() => setRefreshing(false))
        }}
        title="Refresh"
      >
        {/* The icon spins in place while a refresh is in flight; the label never leaves, so the
         *  button's own width stays put instead of visibly collapsing to a bare glyph. */}
        <RefreshIcon className={refreshing ? 'spinner' : undefined} />
        <span>Refresh</span>
      </button>
    </div>
  )
}
