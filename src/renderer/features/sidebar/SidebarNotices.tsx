import type { JSX } from 'react'
import { SEARCH_RESULT_CAP } from '@shared/treeFilter'

/** What the list says when it has nothing to show, or has cut a search short. */
export function SidebarNotices({ isEmpty, searchActive, capped }: {
  isEmpty: boolean
  searchActive: boolean
  capped: boolean
}): JSX.Element {
  return (
    <>
      {isEmpty && !searchActive && (
        <p className="empty" data-testid="sidebar-empty">
          No sessions imported yet.
          <br />
          Use <strong>File &gt; Import Claude Sessions</strong> to choose which ones to show.
          <br />
          <span className="muted">
            Apiary reads ~/.claude/projects, or CLAUDE_CONFIG_DIR when that is set.
          </span>
        </p>
      )}

      {isEmpty && searchActive && (
        <p className="empty" data-testid="sidebar-no-matches">No sessions match that search.</p>
      )}

      {capped && (
        <p className="muted" data-testid="search-cap-note">
          Showing first {SEARCH_RESULT_CAP} results.
        </p>
      )}
    </>
  )
}
