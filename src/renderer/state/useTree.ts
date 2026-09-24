import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { useSessionTreeCache } from './useSessionTreeCache'
import { useNotifications } from './notifications'

export function useTree(
  /** A *settled* query — see `SearchField`. Anything live enough to change per keystroke does not
   *  belong here: everything below it filters, ranks and renders the whole match set. */
  query: string,
  options: { searchChatContent: boolean; searchSessionNotes: boolean },
): {
  tree: ProjectNode[]
  /** The query `tree` was actually filtered by — the raw one, debounced. Anything that ranks or
   *  scores these results must use *this*, not the live input value: the two disagree for 150ms
   *  after every keystroke, and scoring a tree against a query it was not filtered by is both
   *  wrong and, because it re-runs on each keystroke instead of once per pause, slow. */
  settledQuery: string
  /** The unfiltered tree underneath `tree` — every session known anywhere, regardless of what is
   *  typed into the search box. The Active section resolves its titles against this rather than
   *  `tree`, because a tab open in another window must stay readable even when this window's own
   *  search happens to exclude its project. */
  rawTree: ProjectNode[]
  /** Session ids matched by content or a note — Task 9's ranking needs to tell that tier apart
   *  from a title/path/branch match, which `filterTreeLocal` alone cannot. */
  matchedByContent: Set<string>
  totalMatches: number
  capped: boolean
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const { rawTree, loading, reload, reloadNow } = useSessionTreeCache()
  const { notifyError } = useNotifications()
  // Not debounced here any more. `SearchField` owns the typed text and publishes only a settled
  // query, and `Sidebar` defers it on top of that — debouncing a third time would just add 150ms
  // to every search for no benefit.
  const debouncedQuery = query
  const [matchedByContent, setMatchedByContent] = useState<Set<string>>(new Set())

  // Superseded rather than awaited: a slow content search for an old query must never land after
  // a fast one for a newer query and put stale ids on screen — the same shape of bug `useTree`'s
  // old `latest` ref existed to prevent for the whole tree.
  const requestId = useRef(0)
  /** So a failing index is reported once, not on every keystroke — see the catch below. */
  const reportedSearchFailure = useRef(false)
  useEffect(() => {
    const id = ++requestId.current
    const trimmed = debouncedQuery.trim()
    if (trimmed === '' || !(options.searchChatContent || options.searchSessionNotes)) {
      setMatchedByContent(new Set())
      return
    }
    void window.apiary.searchContent(trimmed)
      .then((ids) => {
        if (requestId.current === id) setMatchedByContent(new Set(ids))
      })
      .catch((error: unknown) => {
        if (requestId.current !== id) return
        // Content matches are dropped, not left stale: the sidebar keeps filtering by title, path
        // and branch, so a failed content search narrows the list less rather than showing results
        // for a query nobody typed.
        setMatchedByContent(new Set())
        // Reported once per mount rather than per keystroke. Unreported, this is close to
        // invisible — the sidebar simply stops finding things by what was said in a session, looks
        // like a search that found nothing, and stays that way. Reported every time, a broken
        // index would bury the user in identical toasts as they type.
        if (reportedSearchFailure.current) return
        reportedSearchFailure.current = true
        notifyError(error, 'Searching conversation contents failed')
      })
    // `rawTree` is a dependency on purpose: it changes when the main process says the tree changed,
    // and that is also what it says when the search index has caught up (`onIndexUpdated`). Without
    // it, a query typed in the first second after launch — before indexing had finished — got the
    // empty answer and kept it until the user typed something else, so searching by what was said
    // found nothing. The e2e spec for content search hit exactly that race once it went the other way.
  }, [debouncedQuery, options.searchChatContent, options.searchSessionNotes, rawTree])

  // Memoized on the debounced query, not the raw one: `Sidebar` re-renders on every keystroke
  // (its own `query` state updates in `onChange`), and without this the filter would still run on
  // every one of those renders even though `debouncedQuery` had not settled yet — the exact
  // per-keystroke cost this task exists to remove, just moved from IPC into a local render.
  const { tree, totalMatches } = useMemo(
    () => filterTreeLocal(rawTree, debouncedQuery, matchedByContent),
    [rawTree, debouncedQuery, matchedByContent],
  )
  // Only ever true while something is actually being searched for. `filterTreeLocal` counts the
  // *whole* tree for an empty query — it has nothing to filter by — so a bare `totalMatches >
  // SEARCH_RESULT_CAP` meant anyone with more than 200 sessions read "Showing first 200 results."
  // permanently, above a complete, uncapped tree. Gated on the debounced query rather than the
  // raw one so the note appears and disappears in step with the results it describes.
  const capped = debouncedQuery.trim() !== '' && totalMatches > SEARCH_RESULT_CAP
  return {
    tree, rawTree, settledQuery: debouncedQuery, matchedByContent, totalMatches, capped, loading,
    reload, reloadNow,
  }
}
