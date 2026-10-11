import type { SessionId } from '@shared/domain/ids'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { mergeLatestPage } from '../../state/transcriptMerge'
import { treeStore } from '../../state/treeStore'
import { describeError, type DescribedError } from '../../ui/errors'
import { loadTranscript } from '../../state/transcript'
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
export function useTranscriptPages(sessionId: SessionId, tail: TailRefs): TranscriptPages {
  const { stickToBottomRef, forceScrollRef } = tail
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<DescribedError | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  // Bumped by the error pane's "Try again" button; the initial-load effect keys off it as well as
  // the session id, so a retry re-runs exactly the same load without needing to leave and return.
  const [reloadNonce, setReloadNonce] = useState(0)

  // Monotonically incrementing generation counter, bumped once per initial-load effect run
  // (i.e. once per "visit" to a session — including a second visit to the *same* session id).
  // `loadEarlier` is a callback, not an effect, so it has no built-in cancellation like the
  // effect's `cancelled` flag — this ref lets a paging response that lands after the user has
  // navigated away recognise itself as stale and no-op instead of corrupting whatever is now
  // on screen.
  //
  // A session-id comparison is NOT sufficient here: switching A -> B -> A re-enters the same
  // session id, so a stale response from the *first* visit to A would compare equal to the
  // *second* visit's id and be wrongly treated as fresh, prepending onto (and overwriting the
  // cursor of) a transcript that has already been reloaded. Two visits to the same session id
  // get two different generations, so this discriminates them correctly.
  const generationRef = useRef(0)
  // Guards against a second "Load earlier" click landing before the first request resolves.
  // A ref (not just the `loadingEarlier` state) is required because the check must happen
  // synchronously inside the click handler, before React has necessarily re-rendered the
  // disabled button — state alone could still let a second synchronous click through.
  const loadingEarlierRef = useRef(false)
  // Mirrors `loading` in a ref so the `onTreeChanged` live-refresh handler (registered once per
  // session, not re-created on every render) can see an up-to-date value without becoming a
  // dependency that would force us to resubscribe on every loading-state flip.
  const loadingRef = useRef(true)
  // Guards against a live refresh firing while a previous one is still in flight — `onTreeChanged`
  // can fire again before a slow `transcript()` call resolves, and we don't want overlapping
  // refreshes racing (or stacking network calls) on top of each other.
  const refreshingRef = useRef(false)

  useEffect(() => {
    generationRef.current += 1
    loadingEarlierRef.current = false
    setLoadingEarlier(false)
    refreshingRef.current = false
    // A brand-new visit to a session should always open at the bottom and start "stuck" there,
    // regardless of whatever scroll state the previously-viewed session left behind.
    stickToBottomRef.current = true
    let cancelled = false
    setLoading(true)
    loadingRef.current = true
    setError(null)
    setMessages([])
    loadTranscript(sessionId)
      .then((page) => {
        if (cancelled) return
        // Force the post-render scroll-to-bottom once these messages actually paint — see the
        // layout effect in useTranscriptScroll. Must be set before `setMessages` so it's already
        // true by the time that state update commits.
        forceScrollRef.current = true
        setMessages(page.messages)
        setCursor(page.earlierCursor)
        setSkipped(page.skippedLines)
      })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e)) })
      .finally(() => { if (!cancelled) { setLoading(false); loadingRef.current = false } })
    return () => { cancelled = true }
  }, [sessionId, reloadNonce, stickToBottomRef, forceScrollRef])

  // Live updates: `onTreeChanged` fires (debounced ~1s in the main process) whenever any session
  // file on disk changed, with no per-session payload — so on every firing we just re-fetch this
  // session's latest page and merge in whatever's new. Subscribed once per session visit.
  useEffect(() => {
    const unsubscribe = treeStore.onChanged(() => {
      // Don't refresh while the initial load is still in flight (its own response will already
      // contain the freshest tail) or while a previous refresh hasn't resolved yet.
      if (loadingRef.current || refreshingRef.current) return
      // Captured *now* (not when the effect was set up) so it reflects the current visit even
      // though this callback is registered once per session and invoked repeatedly.
      const requestedGeneration = generationRef.current
      refreshingRef.current = true
      loadTranscript(sessionId)
        .then((page) => {
          // Same staleness guard `loadEarlier` uses: a refresh that resolves after the user has
          // navigated away from (or back around to) this session must not touch state that now
          // belongs to a different visit.
          if (generationRef.current !== requestedGeneration) return
          // Decide *before* merging, based on where the user was sitting before this update
          // arrived — appending messages doesn't itself move their scroll position, so this
          // reflects their actual intent (reading history vs. watching the tail).
          if (stickToBottomRef.current) forceScrollRef.current = true
          setMessages((prev) => mergeLatestPage(prev, page.messages))
          // Deliberately not touching `cursor`/`skipped`: a tail-only refresh has no idea where
          // the *earlier* boundary of the file is, so overwriting them would corrupt "Load
          // earlier messages" (either resetting a cursor the user already paged past, or losing
          // the running skipped-line count).
        })
        // The user is looking at a perfectly good transcript already; a background refresh failing
        // (a transient read error while the file is mid-write) is logged, not shown: the next
        // tree change tries again.
        .catch((e: unknown) => { logBackgroundFailure(e, 'refresh') })
        .finally(() => { refreshingRef.current = false })
    })
    return unsubscribe
  }, [sessionId, stickToBottomRef, forceScrollRef])

  const loadEarlier = useCallback(() => {
    if (cursor === null || loadingEarlierRef.current) return
    const requestedGeneration = generationRef.current
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    void loadTranscript(sessionId, cursor)
      .then((page) => {
        // Stale response for a generation (session visit) the user has since navigated away
        // from — including a round trip back to the same session id — drop it rather than
        // corrupting whatever visit is now on screen.
        if (generationRef.current !== requestedGeneration) return
        setMessages((prev) => [...page.messages, ...prev])
        setCursor(page.earlierCursor)
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
  }, [cursor, sessionId])

  const retry = useCallback(() => { setReloadNonce((n) => n + 1) }, [])
  return { messages, cursor, skipped, error, loading, loadingEarlier, loadEarlier, retry }
}
