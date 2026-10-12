import { type JSX, useState } from 'react'
import type { SessionNode } from '@shared/types'
import type { ChatDecision, ChatState } from '@shared/domain/chat'
import { ChatTimeline, ChatStatus, useCopyOnSelect } from '../chat'
import { MessageRow } from '../../ui/message/MessageRow'
import { FileMentionsProvider } from '../../ui/message/FileMentions'
import { FindBar } from './FindBar'
import { TranscriptError } from './TranscriptError'
import { useTranscriptFind } from './useTranscriptFind'
import { useTranscriptPages } from './useTranscriptPages'
import { useTailRefs, useTranscriptScroll } from './useTranscriptScroll'
import { useTranscriptView } from './transcriptView'

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
  const [showSidechain, setShowSidechain] = useState(false)
  const tail = useTailRefs()
  const pages = useTranscriptPages(session.sessionId, tail)
  const { messages, cursor, skipped, loading, loadingEarlier, loadEarlier } = pages
  const scroll = useTranscriptScroll({ tail, messages, visible, chatMode, chat })
  const { onContextMenu, menu: copyMenu } = useCopyOnSelect(tail.containerRef)
  const { visibleMessages, items, queued, status } = useTranscriptView({
    sessionId: session.sessionId, messages, showSidechain, chatMode, chat, terminalRunning,
  })
  const find = useTranscriptFind({
    containerRef: tail.containerRef, visible, sessionId: session.sessionId, contentKey: visibleMessages, hasEarlier: cursor !== null, loadEarlier,
  })

  if (pages.error !== null) return <TranscriptError error={pages.error} onRetry={pages.retry} />

  return (
    <FileMentionsProvider sessionId={session.sessionId}>
    {find.open && <FindBar find={find} />}
    <div
      className="transcript"
      tabIndex={-1}
      data-testid="transcript"
      ref={tail.containerRef}
      onScroll={scroll.onScroll}
      onWheel={scroll.onWheel}
      onKeyDown={scroll.onKeyDown}
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

      {scroll.showJump && (
        <button className="chat-jump" data-testid="transcript-jump" onClick={scroll.jumpToLatest}>
          Jump to latest ↓
        </button>
      )}
    </div>
    {chatMode && <ChatStatus tasks={status.tasks} turn={status.turn} recap={status.recap} />}
    {copyMenu}
    </FileMentionsProvider>
  )
}
