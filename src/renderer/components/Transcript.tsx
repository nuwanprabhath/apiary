import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionNode, TranscriptMessage } from '@shared/types'
import { MessageRow } from './MessageRow'

export function Transcript({ session }: { session: SessionNode }): JSX.Element {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showSidechain, setShowSidechain] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)

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

  useEffect(() => {
    generationRef.current += 1
    loadingEarlierRef.current = false
    setLoadingEarlier(false)
    let cancelled = false
    setLoading(true)
    setError(null)
    setMessages([])
    window.apiary
      .transcript(session.sessionId)
      .then((page) => {
        if (cancelled) return
        setMessages(page.messages)
        setCursor(page.earlierCursor)
        setSkipped(page.skippedLines)
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session.sessionId])

  const loadEarlier = useCallback(() => {
    if (cursor === null || loadingEarlierRef.current) return
    const requestedSessionId = session.sessionId
    const requestedGeneration = generationRef.current
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    void window.apiary
      .transcript(requestedSessionId, cursor)
      .then((page) => {
        // Stale response for a generation (session visit) the user has since navigated away
        // from — including a round trip back to the same session id — drop it rather than
        // corrupting whatever visit is now on screen.
        if (generationRef.current !== requestedGeneration) return
        setMessages((prev) => [...page.messages, ...prev])
        setCursor(page.earlierCursor)
        setSkipped((prev) => prev + page.skippedLines)
      })
      .catch((e: Error) => {
        if (generationRef.current !== requestedGeneration) return
        setError(e.message)
      })
      .finally(() => {
        if (generationRef.current !== requestedGeneration) return
        loadingEarlierRef.current = false
        setLoadingEarlier(false)
      })
  }, [cursor, session.sessionId])

  const visible = showSidechain ? messages : messages.filter((m) => !m.isSidechain)

  if (error !== null) {
    return <p className="empty" data-testid="transcript-error">Could not read this session: {error}</p>
  }

  return (
    <div className="transcript" data-testid="transcript">
      <div className="transcript-toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            data-testid="sidechain-toggle"
            checked={showSidechain}
            onChange={(e) => setShowSidechain(e.target.checked)}
          />
          Show subagent messages
        </label>
        {skipped > 0 && (
          <span className="muted" data-testid="transcript-skipped">
            {skipped} unreadable line(s) skipped
          </span>
        )}
      </div>

      {cursor !== null && (
        <button
          className="load-earlier"
          data-testid="load-earlier"
          onClick={loadEarlier}
          disabled={loadingEarlier}
        >
          {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
        </button>
      )}

      {loading && <p className="empty">Loading transcript...</p>}

      {visible.map((m, i) => (
        <MessageRow key={m.uuid.length > 0 ? m.uuid : String(i)} message={m} />
      ))}

      {!loading && visible.length === 0 && (
        <p className="empty" data-testid="transcript-empty">This session has no messages yet.</p>
      )}
    </div>
  )
}
