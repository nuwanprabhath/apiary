import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { useSessionTreeCache } from './useSessionTreeCache'
import { useNotifications } from '../ui/notifications'
import { searchContent } from './sessions'

export function useTree(
  /** A *settled* query — see `SearchField`. Anything live enough to change per keystroke does not
   *  belong here: everything below it filters, ranks and renders the whole match set. */
  query: string,
  options: { searchChatContent: boolean; searchSessionNotes: boolean },
): {
  tree: ProjectNode[]
  /** The query `tree` was actually filtered by — the raw one, debounced. Anything that ranks or
   *  scores these results must use *this*, not the live input value: the two disagree for 150ms
   *  after every keystroke. */
  settledQuery: string
  /** The unfiltered tree underneath `tree` — every session known anywhere, regardless of what is
   *  typed into the search box. The Active section resolves its titles against this rather than
   *  `tree`, because a tab open in another window must stay readable even when this window's own
   *  search happens to exclude its project. */
  rawTree: ProjectNode[]
  /** Session ids matched by content or a note — content-search ranking needs to tell that tier
   *  apart from a title/path/branch match, which `filterTreeLocal` alone cannot. */
  matchedByContent: Set<string>
  totalMatches: number
  capped: boolean
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const { rawTree, loading, reload, reloadNow } = useSessionTreeCache()
  const { notifyError } = useNotifications()
  const [matchedByContent, setMatchedByContent] = useState<Set<string>>(() => new Set())

  // Superseded rather than awaited: a slow search for an old query must never land after a fast
  // one for a newer query.
  const requestId = useRef(0)
  /** So a failing index is reported once, not on every keystroke — see the catch below. */
  const reportedSearchFailure = useRef(false)
  useEffect(() => {
    const id = ++requestId.current
    const trimmed = query.trim()
    if (trimmed === '' || !(options.searchChatContent || options.searchSessionNotes)) {
      setMatchedByContent(new Set())
      return
    }
    void searchContent(trimmed)
      .then((ids) => {
        if (requestId.current === id) setMatchedByContent(new Set(ids))
      })
      .catch((error: unknown) => {
        if (requestId.current !== id) return
        // Content matches are dropped, not left stale: the sidebar keeps filtering by title, path
        // and branch.
        setMatchedByContent(new Set())
        // Once per mount: unreported, a broken index looks like a search that found nothing;
        // reported per keystroke, it buries the user in identical toasts.
        if (reportedSearchFailure.current) return
        reportedSearchFailure.current = true
        notifyError(error, 'Searching conversation contents failed')
      })
    // `rawTree` is a dependency on purpose: main says the tree changed when the search index has
    // caught up (`onIndexUpdated`). Without it, a query typed before indexing finished keeps its
    // empty answer until the user types something else.
  }, [query, options.searchChatContent, options.searchSessionNotes, rawTree, notifyError])

  // Memoized on the debounced query: `Sidebar` re-renders on every keystroke, and the filter should
  // not run on each of those.
  const { tree, totalMatches } = useMemo(
    () => filterTreeLocal(rawTree, query, matchedByContent),
    [rawTree, query, matchedByContent],
  )
  // Only true while something is searched for: `filterTreeLocal` counts the *whole* tree for an
  // empty query. Gated on the debounced query so the note moves in step with the results.
  const capped = query.trim() !== '' && totalMatches > SEARCH_RESULT_CAP
  return {
    tree, rawTree, settledQuery: query, matchedByContent, totalMatches, capped, loading,
    reload, reloadNow,
  }
}
