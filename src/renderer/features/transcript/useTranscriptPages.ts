import type { SessionId } from '@shared/domain/ids'
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { mergeLatestPage } from '../../state/transcriptMerge'
import { windowHeld } from '../../state/transcriptWindow'
import { treeStore } from '../../state/treeStore'
import { describeError, type DescribedError } from '../../ui/errors'
import { loadTranscript, loadTranscriptAfter } from '../../state/transcript'
import { logBackgroundFailure } from '../../ui/fireAndForget'
import type { TailRefs } from './useTranscriptScroll'

export interface TranscriptPages {
  messages: TranscriptMessage[]
  /** Where "Load earlier messages" continues from, or null when the whole file is loaded. */
  cursor: number | null
  skipped: number
  error: DescribedError | null
  loading: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
  /** Run the initial load again — the error pane's "Try again". */
  retry: () => void
}

/** The session's messages: the newest page on open, earlier pages on request, and the newest
 *  page again whenever a session file changes on disk. */
export function useTranscriptPages(
  sessionId: SessionId,
  tail: TailRefs,
  /** Whether the find bar is open: while it is, nothing is trimmed. */
  findOpenRef: RefObject<boolean>,
): TranscriptPages {
  const { stickToBottomRef, forceScrollRef } = tail
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<DescribedError | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  // Bumped by "Try again"; the initial-load effect keys off it as well as the session id.
  const [reloadNonce, setReloadNonce] = useState(0)

  // Bumped once per initial-load run (once per "visit" to a session). A paging response that lands
  // after the user navigated away recognises itself as stale. A session-id comparison is not
  // enough: A -> B -> A re-enters the same id, so a stale response from the first visit would
  // compare equal and prepend onto an already reloaded transcript.
  const generationRef = useRef(0)
  // A ref, not the `loadingEarlier` state: the check must be synchronous in the click handler,
  // before React re-renders the disabled button.
  const loadingEarlierRef = useRef(false)
  // Mirrors `loading` so the once-per-session `onTreeChanged` handler sees a current value without
  // resubscribing on every flip.
  const loadingRef = useRef(true)
  // `onTreeChanged` can fire again before a slow `transcript()` call resolves; no overlapping refreshes.
  const refreshingRef = useRef(false)
  // Mirror `messages` and `cursor` for the async handlers, which must read what is held now.
  const messagesRef = useRef<TranscriptMessage[]>([])
  const cursorRef = useRef<number | null>(null)
  // The scroll height before an earlier page landed on a container scrolled to its top, or null.
  const topAnchorRef = useRef<number | null>(null)
  const commit = useCallback((next: TranscriptMessage[], nextCursor: number | null) => {
    messagesRef.current = next
    cursorRef.current = nextCursor
    setMessages(next)
    setCursor(nextCursor)
  }, [])

  useEffect(() => {
    generationRef.current += 1
    loadingEarlierRef.current = false
    setLoadingEarlier(false)
    refreshingRef.current = false
    // A new visit opens at the bottom, stuck there.
    stickToBottomRef.current = true
    let cancelled = false
    setLoading(true)
    loadingRef.current = true
    setError(null)
    commit([], null)
    loadTranscript(sessionId)
      .then((page) => {
        if (cancelled) return
        // Set before the commit so it is armed when the layout effect in useTranscriptScroll runs.
        forceScrollRef.current = true
        commit(page.messages, page.earlierCursor)
        setSkipped(page.skippedLines)
      })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e)) })
      .finally(() => { if (!cancelled) { setLoading(false); loadingRef.current = false } })
    return () => { cancelled = true }
  }, [sessionId, reloadNonce, stickToBottomRef, forceScrollRef, commit])

  // `onTreeChanged` (debounced ~1s in main) carries no per-session payload, so each firing
  // re-fetches this session's latest page and merges it.
  useEffect(() => {
    const unsubscribe = treeStore.onChanged(() => {
      // The initial load's own response already has the freshest tail.
      if (loadingRef.current || refreshingRef.current) return
      // Captured per firing, not at setup, so it reflects the current visit.
      const requestedGeneration = generationRef.current
      refreshingRef.current = true
      // Only what follows the last held message, when it has a line index to ask after.
      const lastIndex = messagesRef.current.at(-1)?.index
      ;(lastIndex === undefined ? loadTranscript(sessionId) : loadTranscriptAfter(sessionId, lastIndex))
        .then((page) => {
          if (generationRef.current !== requestedGeneration) return
          if (page.messages.length === 0) return
          // Decided before merging: appending does not move the scroll position, so this still
          // reflects whether they were reading history or watching the tail.
          const following = stickToBottomRef.current
          if (following) forceScrollRef.current = true
          const trimmable = following && !findOpenRef.current
          // A burst of more than a page: the newest page does not join what is held, so while
          // following it replaces it, and the held messages load back through the new cursor.
          if (trimmable && page.earlierCursor !== null) {
            commit(page.messages, page.earlierCursor)
            return
          }
          const merged = mergeLatestPage(messagesRef.current, page.messages)
          if (merged === messagesRef.current) return
          const held = trimmable ? windowHeld(merged, cursorRef.current) : { messages: merged, cursor: cursorRef.current }
          commit(held.messages, held.cursor)
          // `skipped` stays: a tail-only refresh does not know the earlier boundary.
        })
        // A transient read error mid-write is logged, not shown: the next tree change retries.
        .catch((e: unknown) => { logBackgroundFailure(e, 'refresh') })
        .finally(() => { refreshingRef.current = false })
    })
    return unsubscribe
  }, [sessionId, stickToBottomRef, forceScrollRef, findOpenRef, commit])

  const loadEarlier = useCallback(() => {
    if (cursor === null || loadingEarlierRef.current) return
    const requestedGeneration = generationRef.current
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    void loadTranscript(sessionId, cursor)
      .then((page) => {
        if (generationRef.current !== requestedGeneration) return
        // Chromium does not scroll-anchor a container at its very top, so a prepend there would
        // leave the reader at the new first row; remember the height to restore the offset.
        const el = tail.containerRef.current
        if (el !== null && el.scrollTop === 0) topAnchorRef.current = el.scrollHeight
        commit([...page.messages, ...messagesRef.current], page.earlierCursor)
        setSkipped((prev) => prev + page.skippedLines)
      })
      .catch((e: unknown) => {
        if (generationRef.current !== requestedGeneration) return
        setError(describeError(e))
      })
      .finally(() => {
        if (generationRef.current !== requestedGeneration) return
        loadingEarlierRef.current = false
        setLoadingEarlier(false)
      })
  }, [cursor, sessionId, commit, tail.containerRef])

  useLayoutEffect(() => {
    const before = topAnchorRef.current
    const el = tail.containerRef.current
    topAnchorRef.current = null
    if (before !== null && el !== null) el.scrollTop = el.scrollHeight - before
  }, [messages, tail.containerRef])

  const retry = useCallback(() => { setReloadNonce((n) => n + 1) }, [])
  return { messages, cursor, skipped, error, loading, loadingEarlier, loadEarlier, retry }
}
