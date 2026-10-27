import { type JSX, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { askAside, clearAside, closeAside, useAsideThread, type AsideTurn } from '../../state/chatAside'
import { useAppSettings } from '../../state/settingsStore'
import { BusyGlyph } from '../../ui/BusyGlyph'
import { TrashIcon } from '../../ui/icons'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { MarkdownText } from '../../ui/message/MarkdownText'

function Turn({ turn }: { turn: AsideTurn }): JSX.Element {
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  return (
    <div className="chat-aside-turn" data-testid="chat-aside-turn" data-status={turn.status}>
      <div className="chat-aside-question" data-testid="chat-aside-question">{turn.question}</div>
      <div className="chat-aside-answer" data-testid="chat-aside-answer">
        {turn.status === 'asking' && (
          <span className="chat-aside-asking" role="status">
            <BusyGlyph animation={busyAnimation} color={busyAnimationColor} />
            Answering, without interrupting Claude…
          </span>
        )}
        {turn.status === 'answered' && turn.answer !== null && <MarkdownText text={turn.answer} />}
        {turn.status === 'failed' && <span className="chat-aside-error" role="alert">{turn.error}</span>}
      </div>
    </div>
  )
}

/**
 * A session's side questions (`/btw`): a thread over the message box, with a box of its own for
 * follow-ups, so a question about an answer stays in the thread instead of reaching the chat. It is
 * not part of the conversation; Claude's main turn goes on underneath. `/btw` alone brings it back as
 * it was left. Escape (inside it) or × puts it away; the bin clears the thread.
 */
export function AsideCard({ sessionId }: { sessionId: SessionId }): JSX.Element | null {
  const thread = useAsideThread(sessionId)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const turns = thread?.turns ?? []
  const last = turns.at(-1)
  const asking = last?.status === 'asking'

  // The newest exchange in view: a new question, and its answer arriving.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [turns.length, last?.status])

  if (thread === null || !thread.open) return null

  const send = (): void => {
    const question = draft.trim()
    if (question === '' || asking) return
    askAside(sessionId, question)
    setDraft('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  return (
    <section
      className="chat-aside"
      data-testid="chat-aside"
      aria-label="Side question"
      // Escape from inside it only: in the message box it stops Claude, which must not also close this.
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAside(sessionId) } }}
    >
      <header className="chat-aside-head">
        <span className="chat-aside-label">Side question</span>
        <span className="chat-aside-hint" title="Not part of the conversation">Not part of the conversation</span>
        <button
          type="button"
          className="chat-aside-button"
          data-testid="chat-aside-clear"
          aria-label="Clear the side questions"
          title="Clear the thread"
          disabled={turns.length === 0}
          onClick={() => { clearAside(sessionId) }}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className="chat-aside-button"
          data-testid="chat-aside-close"
          aria-label="Close the side question"
          title="Close (Esc). /btw opens it again"
          onClick={() => { closeAside(sessionId) }}
        >
          ×
        </button>
      </header>
      <div className="chat-aside-thread" data-testid="chat-aside-thread" ref={listRef}>
        {turns.length === 0
          ? <p className="chat-aside-empty">Ask about the conversation without interrupting Claude. Nothing here is sent to it.</p>
          : turns.map((t) => <Turn key={t.askedAt} turn={t} />)}
      </div>
      <div className="chat-aside-compose">
        <textarea
          ref={focusAskedFor}
          className="chat-aside-input"
          data-testid="chat-aside-input"
          rows={1}
          value={draft}
          placeholder={turns.length === 0 ? 'Ask a side question' : 'Ask a follow-up'}
          aria-label="Side question"
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="btn small primary"
          data-testid="chat-aside-send"
          disabled={draft.trim() === '' || asking}
          title={asking ? 'Waiting for the answer' : 'Ask (Enter)'}
          onClick={send}
        >
          Ask
        </button>
      </div>
    </section>
  )
}
