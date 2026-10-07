import { type JSX, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionNode, TranscriptMessage } from '@shared/types'
import type { ChatDecision, ChatState } from '@shared/domain/chat'
import { chatItems, latestTurn, mergeLive, runningBackgroundTasks, stillQueued } from '@shared/chatTimeline'
import { ChatTimeline } from '../chat/ChatTimeline'
import { ChatStatus, type ChatStatusInfo } from '../chat/ChatStatus'
import { useCopyOnSelect } from '../chat/useCopyOnSelect'
import { MessageRow } from './MessageRow'
import { mergeLatestPage } from '../../state/transcriptMerge'
import { describeError, type DescribedError } from '../../ui/errors'

// How close to the bottom (in pixels) counts as being at it, for following new content again.
// Deliberately tight: this used to be 64px, and a trackpad scrolls up a few pixels per event — so
// the first events of a scroll up still counted as "at the bottom", and the next streamed word
// (every 40ms in a chat) pulled the view back down. Leaving the bottom is now decided by the
// direction you scroll (see handleScroll), and only coming back all the way re-attaches.
const STICKY_BOTTOM_THRESHOLD_PX = 4
// Scrolled up further than this, the "Jump to latest" button shows.
const JUMP_BUTTON_THRESHOLD_PX = 240

interface TranscriptProps {
  session: SessionNode
  /**
   * Whether this transcript is the pane currently on screen. It stays mounted while the session's
   * live terminal is in front (that is what keeps it following along), but a hidden element has no
   * layout, so anything that needs to *scroll* it has to wait until it is shown again.
   */
  visible?: boolean
  /** Opens an image full size. Owned by the column, so the composer's images use the same one. */
  onOpenImage: (src: string) => void
  /** Draw it as a chat (the "Run sessions as a chat" setting), with `chat`'s live part on top. */
  chatMode?: boolean
  chat?: ChatState | null
  onDecide?: (requestId: string, decision: ChatDecision) => void
  /** Whether the session's claude is running in its terminal — background tasks are only still
   *  running while their process is. */
  terminalRunning?: boolean
}

export function Transcript({
  session, visible = true, onOpenImage, chatMode = false, chat = null, onDecide, terminalRunning = false,
}: TranscriptProps): JSX.Element {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<DescribedError | null>(null)
  const [showSidechain, setShowSidechain] = useState(false)
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

  // Scroll container + "is the user currently at (or very near) the bottom" tracking, used for
  // both requirements: scrolling to the bottom on open, and re-sticking to the bottom on live
  // updates only if the user hadn't scrolled away to read history.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  // Set to true whenever the *next* commit of `messages` should be force-scrolled to the bottom
  // regardless of `stickToBottomRef` (a fresh session load, or a live update that arrived while
  // already stuck to the bottom). Consumed and cleared by the layout effect below. A ref (not
  // state) because setting it must never itself trigger an extra render.
  const forceScrollRef = useRef(false)

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
    window.apiary
      .transcript(session.sessionId)
      .then((page) => {
        if (cancelled) return
        // Force the post-render scroll-to-bottom once these messages actually paint — see the
        // layout effect below. Must be set before `setMessages` so it's already true by the time
        // that state update commits.
        forceScrollRef.current = true
        setMessages(page.messages)
        setCursor(page.earlierCursor)
        setSkipped(page.skippedLines)
      })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e)) })
      .finally(() => { if (!cancelled) { setLoading(false); loadingRef.current = false } })
    return () => { cancelled = true }
  }, [session.sessionId, reloadNonce])

  // Scroll-to-bottom effect. Runs after `messages` has actually committed to the DOM (layout
  // effect, not a regular effect), so it never scrolls a container that's still empty from the
  // pre-load reset. It re-runs on every `messages` change but only acts when `forceScrollRef` was
  // armed (initial load finishing, or a live update landing while already at the bottom) —
  // otherwise a `loadEarlier` prepend (which also changes `messages`) would yank the view down to
  // the bottom right after the user asked to see *earlier* content.
  useLayoutEffect(() => {
    if (!forceScrollRef.current) return
    // Stay armed while hidden rather than consuming the flag here. A display:none element has no
    // scrollHeight and ignores scrollTop, so running now would silently do nothing *and* throw
    // away the instruction — which is exactly how watching a session run in the terminal and then
    // switching to its transcript used to land you at the oldest message instead of the newest.
    // The visibility effect below performs the deferred scroll instead.
    if (!visible) return
    forceScrollRef.current = false
    const el = containerRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    // We just landed exactly at the bottom, so the user counts as "stuck" again for the next
    // live update.
    stickToBottomRef.current = true
  }, [messages, visible])

  /**
   * Catches the transcript up the moment it comes back on screen.
   *
   * While the live terminal is in front this component keeps running — it still receives every
   * `onTreeChanged` and merges in new messages — so the content is already current. What it cannot
   * do while hidden is move its own scroll position. Switching back therefore has to re-run the
   * scroll that was deferred above, so you land on what the session has just said rather than on
   * wherever the view happened to be parked when you left it.
   *
   * Only when the reader was following the tail: someone who deliberately scrolled up to read
   * history, then glanced at the terminal, should come back to the same place they left.
   */
  useEffect(() => {
    if (!visible) return
    if (!stickToBottomRef.current && !forceScrollRef.current) return
    const id = requestAnimationFrame(() => {
      forceScrollRef.current = false
      const el = containerRef.current
      if (el === null) return
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  // Tracks whether the user is currently at (or very near) the bottom, so a live refresh knows
  // whether it's allowed to auto-scroll. Read live-refresh's comment for how this is used.
  //
  // Moving up at all leaves the bottom; only reaching it again re-attaches. Content growing never
  // moves `scrollTop`, and content shrinking under you while you sit at the bottom leaves you at
  // the bottom, so a move up is always you (or "go to this message", which is also you).
  const lastScrollTopRef = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const movedUp = el.scrollTop < lastScrollTopRef.current - 1
    lastScrollTopRef.current = el.scrollTop
    if (distanceFromBottom <= STICKY_BOTTOM_THRESHOLD_PX) stickToBottomRef.current = true
    else if (movedUp) stickToBottomRef.current = false
    setShowJump(!stickToBottomRef.current && distanceFromBottom > JUMP_BUTTON_THRESHOLD_PX)
  }, [])
  // A wheel or key turned upwards says "stop following" before the scroll event even lands — the
  // first notch would otherwise race a streamed word that puts the view straight back down.
  const stopFollowing = useCallback(() => { stickToBottomRef.current = false }, [])
  const jumpToLatest = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    stickToBottomRef.current = true
    el.scrollTop = el.scrollHeight
    setShowJump(false)
  }, [])
  const { onContextMenu, menu: copyMenu } = useCopyOnSelect(containerRef)

  // Live updates: `onTreeChanged` fires (debounced ~1s in the main process) whenever any session
  // file on disk changed, with no per-session payload — so on every firing we just re-fetch this
  // session's latest page and merge in whatever's new. Subscribed once per session visit.
  useEffect(() => {
    const requestedSessionId = session.sessionId
    const unsubscribe = window.apiary.onTreeChanged(() => {
      // Don't refresh while the initial load is still in flight (its own response will already
      // contain the freshest tail) or while a previous refresh hasn't resolved yet.
      if (loadingRef.current || refreshingRef.current) return
      // Captured *now* (not when the effect was set up) so it reflects the current visit even
      // though this callback is registered once per session and invoked repeatedly.
      const requestedGeneration = generationRef.current
      refreshingRef.current = true
      window.apiary
        .transcript(requestedSessionId)
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
        .catch(() => {
          // The user is looking at a perfectly good transcript already; a background refresh
          // failing (e.g. a transient read error while the file is mid-write) is not something
          // they need to see or be interrupted by. Swallow it — the next `onTreeChanged` firing
          // will simply try again. (Unlike the initial load or `loadEarlier`, there is no
          // "loading earlier" state.)
        })
        .finally(() => { refreshingRef.current = false })
    })
    return unsubscribe
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
      .catch((e: unknown) => {
        if (generationRef.current !== requestedGeneration) return
        setError(describeError(e))
      })
      .finally(() => {
        if (generationRef.current !== requestedGeneration) return
        loadingEarlierRef.current = false
        setLoadingEarlier(false)
      })
  }, [cursor, session.sessionId])

  // UI-8: filtering on every render built a fresh array even when nothing about `messages` or
  // `showSidechain` had changed — cheap for one render, but this list only grows, and a filter
  // over the whole thing ran on every unrelated re-render of `Transcript` too.
  const visibleMessages = useMemo(
    () => (showSidechain ? messages : messages.filter((m) => !m.isSidechain)),
    [messages, showSidechain],
  )

  // Chat view: the file's messages plus whatever the chat has streamed that the file has not caught
  // up with yet (matched by uuid, so nothing shows twice).
  const items = useMemo(() => {
    if (!chatMode) return []
    const live = (chat?.live ?? []).filter((m) => showSidechain || !m.isSidechain)
    return chatItems(mergeLive(visibleMessages, live))
  }, [chatMode, chat?.live, visibleMessages, showSidechain])
  const queued = useMemo(() => stillQueued(chat?.queued ?? [], messages), [chat?.queued, messages])

  // The line above the message box: background tasks still running (claude's own list while it
  // runs as a chat, else the file's, while its terminal runs), and how the latest turn ended.
  const status = useMemo((): ChatStatusInfo => {
    if (!chatMode) return { tasks: [], turn: null, recap: null }
    const chatRunning = chat !== null && chat.status !== 'exited'
    const tasks = chatRunning && chat.backgroundTasks !== null
      ? chat.backgroundTasks
      : chatRunning || terminalRunning ? runningBackgroundTasks(messages) : []
    if (chat?.status === 'busy') return { tasks, turn: null, recap: null }
    const fromFile = latestTurn(messages)
    const live = chat?.lastTurn ?? null
    const turn = live !== null && (fromFile.endedAtMs === null || live.endedAt >= fromFile.endedAtMs)
      ? { durationMs: live.durationMs, endedAtMs: live.endedAt }
      : fromFile.durationMs !== null ? { durationMs: fromFile.durationMs, endedAtMs: fromFile.endedAtMs } : null
    return { tasks, turn, recap: fromFile.recap }
  }, [chatMode, chat, messages, terminalRunning])

  // A streamed word, a permission prompt or the working line appearing keeps the view at the
  // bottom — the same rule a new message from the file follows: only if you were already there.
  useLayoutEffect(() => {
    if (!chatMode || chat === null || !stickToBottomRef.current) return
    const el = containerRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [chatMode, chat])

  if (error !== null) {
    // Shown in place rather than as a notification: the pane has nothing else to display, and a
    // toast over an empty pane would leave the user staring at a blank area once it was
    // dismissed. The failure still reads as a sentence, with the raw text behind a disclosure.
    return (
      <div className="transcript-error" data-testid="transcript-error">
        <p className="crash-message">{error.message}</p>
        {error.detail !== null && (
          <details className="crash-detail">
            <summary>Technical details</summary>
            <pre>{error.detail}</pre>
          </details>
        )}
        <div className="crash-actions">
          <button
            className="btn primary"
            data-testid="transcript-retry"
            onClick={() => { setReloadNonce((n) => n + 1) }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
    <div
      className="transcript"
      data-testid="transcript"
      ref={containerRef}
      onScroll={handleScroll}
      onWheel={(e) => { if (e.deltaY < 0) stopFollowing() }}
      onKeyDown={(e) => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) stopFollowing() }}
      onContextMenu={onContextMenu}
    >
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

      {loading && <p className="empty">Loading chat...</p>}

      {chatMode
        ? <ChatTimeline items={items} chat={chat} queued={queued} onOpenImage={onOpenImage} onDecide={(id, d) => { onDecide?.(id, d) }} />
        : visibleMessages.map((m, i) => (
          <MessageRow
            // eslint-disable-next-line @eslint-react/no-array-index-key -- falls back to the index only for the rare message with no uuid; the uuid is the real, stable key
            key={m.uuid.length > 0 ? m.uuid : String(i)}
            message={m}
            onOpenImage={onOpenImage}
          />
        ))}

      {!loading && visibleMessages.length === 0 && (chat?.live.length ?? 0) === 0 && (
        <p className="empty" data-testid="transcript-empty">This session has no messages yet.</p>
      )}

      {showJump && (
        <button className="chat-jump" data-testid="transcript-jump" onClick={jumpToLatest}>
          Jump to latest ↓
        </button>
      )}
    </div>
    {chatMode && <ChatStatus tasks={status.tasks} turn={status.turn} recap={status.recap} />}
    {copyMenu}
    </>
  )
}
