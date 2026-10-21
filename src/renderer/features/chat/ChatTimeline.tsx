import { Fragment, type JSX, memo, useEffect, useRef, useState } from 'react'
import type { ChatDecision, ChatState, QueuedMessage } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { lastPrompt, type ChatItem } from '@shared/chatTimeline'
import { formatDuration } from '@shared/time'
import { TextBlock } from '../../ui/message/MessageRow'
import { ImageThumbnail } from '../../ui/message/TranscriptImage'
import { MarkdownText } from '../../ui/message/MarkdownText'
import { PeerMessage } from '../../ui/message/PeerMessage'
import { StreamingMarkdown } from './StreamingMarkdown'
import { MessageTime } from '../../ui/MessageTime'
import { ToolCall } from './ToolCall'
import { PermissionCard } from './PermissionCard'
import { WorkingLine } from './WorkingLine'
import { sendChatNow } from '../../state/chatStore'

interface Props {
  items: ChatItem[]
  /** The session's chat, when it has run as one this launch — for what is live right now. */
  chat: ChatState | null
  /** The chat's queued messages the conversation does not show yet (`stillQueued`). */
  queued: QueuedMessage[]
  onOpenImage: (src: string) => void
  onDecide: (requestId: string, decision: ChatDecision) => void
  /** Claude is working in the session's terminal: the reply arrives through the JSONL, not `chat`. */
  terminalBusy?: boolean
}

function QueuedSendButton({ sessionId, queuedId }: { sessionId: SessionId; queuedId: string }): JSX.Element {
  return (
    <button
      className="chat-queued-send-btn"
      onClick={() => { sendChatNow(sessionId, queuedId) }}
      title="Send now, stopping the current turn first if Claude is still working"
      data-testid="chat-queued-send-btn"
    >
      Send now
    </button>
  )
}

const Thought = memo(function Thought(
  { text, timing }: { text: string; timing: { seconds: number; tokens: number | null } | undefined },
): JSX.Element {
  const [open, setOpen] = useState(false)
  const label = timing === undefined
    ? 'Thought'
    : `Thought for ${formatDuration(timing.seconds * 1000)}${timing.tokens !== null ? ` · ${timing.tokens.toLocaleString()} tokens` : ''}`
  // Claude Code keeps only a signature for most thinking, so there is often nothing to expand.
  const hasText = text.trim() !== ''
  return (
    <div className="chat-row" data-testid="chat-thought">
      <span className="chat-dot" aria-hidden="true" />
      <div className="chat-row-body">
        {hasText
          ? <button className="chat-thought-toggle" aria-expanded={open} onClick={() => { setOpen(!open) }}>{label}</button>
          : <span className="chat-thought-label">{label}</span>}
        {open && <pre className="chat-thought-text">{text}</pre>}
      </div>
    </div>
  )
})

type Timing = { seconds: number; tokens: number | null } | undefined

/** `chatItems` rebuilds every item on each update, so rows are compared by what they draw. */
function sameItem(a: ChatItem, b: ChatItem): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.key !== b.key) return false
  switch (a.kind) {
    case 'user': return b.kind === 'user' && a.text === b.text && a.timestampMs === b.timestampMs && a.images.join('\n') === b.images.join('\n')
    case 'text': return b.kind === 'text' && a.text === b.text && a.timestampMs === b.timestampMs
    case 'thinking': return b.kind === 'thinking' && a.text === b.text && a.uuid === b.uuid
    case 'tool': return b.kind === 'tool' && a.name === b.name
      && (a.input === b.input || JSON.stringify(a.input) === JSON.stringify(b.input))
      && a.result?.content === b.result?.content && a.result?.isError === b.result?.isError
    case 'interrupted': return true
    case 'notice': return b.kind === 'notice' && a.text === b.text && a.status === b.status
    case 'peer': return b.kind === 'peer' && a.text === b.text && a.from === b.from && a.timestampMs === b.timestampMs
  }
}

const Item = memo(function Item(
  { item, timing, onOpenImage }: { item: ChatItem; timing: Timing; onOpenImage: (src: string) => void },
): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <>
          <MessageTime ms={item.timestampMs} />
          <div className="chat-user" data-testid="chat-user" data-key={item.key}>
            <TextBlock text={item.text} onOpenImage={onOpenImage} />
            {item.images.map((src) => <ImageThumbnail key={src.slice(-32)} src={src} onOpen={onOpenImage} />)}
          </div>
        </>
      )
    case 'text':
      return (
        <>
          <div className="chat-row" data-testid="chat-text">
            <span className="chat-dot" aria-hidden="true" />
            <div className="chat-row-body"><MessageTime ms={item.timestampMs} inline /><TextBlock text={item.text} onOpenImage={onOpenImage} /></div>
          </div>
        </>
      )
    case 'thinking':
      return <Thought text={item.text} timing={timing} />
    case 'tool':
      return <ToolCall name={item.name} input={item.input} result={item.result} />
    case 'interrupted':
      return <div className="chat-interrupted" data-testid="chat-interrupted">Interrupted — tell Claude what to do instead.</div>
    case 'notice':
      return (
        <div className="chat-row chat-notice" data-testid="chat-notice" data-status={item.status ?? ''}>
          <span className="chat-dot" aria-hidden="true" />
          <div className="chat-row-body">{item.text}</div>
        </div>
      )
    case 'peer':
      return (
        <>
          <MessageTime ms={item.timestampMs} />
          <PeerMessage from={item.from} text={item.text} />
        </>
      )
  }
}, (prev, next) => prev.timing?.seconds === next.timing?.seconds && prev.timing?.tokens === next.timing?.tokens
  && prev.onOpenImage === next.onOpenImage && sameItem(prev.item, next.item))

/**
 * The latest prompt, pinned once the message itself has scrolled out above. The pin has no height
 * of its own (the box hangs out of a zero-height sticky row), so it never moves the conversation.
 */
function StickyPrompt({ prompt }: { prompt: { key: string; text: string } }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [above, setAbove] = useState(false)
  useEffect(() => {
    const root = ref.current?.closest('.transcript') ?? null
    const target = root?.querySelector(`[data-key="${CSS.escape(prompt.key)}"]`) ?? null
    if (root === null || target === null) { setAbove(false); return }
    const observer = new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds?.top ?? 0
      setAbove(!entry.isIntersecting && entry.boundingClientRect.top < rootTop)
    }, { root })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [prompt.key])
  return (
    <div className="chat-sticky" ref={ref}>
      {above && (
        <button
          className="chat-sticky-prompt"
          data-popup=""
          data-testid="chat-sticky-prompt"
          title="Go to this message"
          onClick={() => {
            const target = ref.current?.closest('.transcript')?.querySelector(`[data-key="${CSS.escape(prompt.key)}"]`)
            target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}
        >
          {prompt.text}
        </button>
      )}
    </div>
  )
}

/** Whether `busy` was already true when this mounted and has not stopped since: the view opened
 *  mid-turn, so it never saw the turn start. */
function useOpenedMidTurn(busy: boolean): boolean {
  const [midTurn, setMidTurn] = useState(busy)
  if (midTurn && !busy) setMidTurn(false)
  return midTurn
}

/** Everything above the live part comes from the session's JSONL; the live part (streamed reply,
 *  permission prompts, working line) comes from the chat process. */
export function ChatTimeline({ items, chat, queued, onOpenImage, onDecide, terminalBusy = false }: Props): JSX.Element {
  const prompt = lastPrompt(items)
  const streaming = chat?.streaming ?? null
  const busy = chat?.status === 'busy'
  const chatRunning = chat !== null && chat.status !== 'exited'
  const openedMidTurn = useOpenedMidTurn(terminalBusy)
  return (
    <div className="chat-timeline" data-testid="chat-timeline">
      {prompt !== null && <StickyPrompt prompt={prompt} />}
      {items.map((item) => <Item key={item.key} item={item} timing={item.kind === 'thinking' ? chat?.thoughts[item.uuid] : undefined} onOpenImage={onOpenImage} />)}
      {streaming !== null && streaming.text !== '' && (
        <div className="chat-row chat-streaming" data-testid="chat-streaming">
          <span className="chat-dot" aria-hidden="true" />
          <div className="chat-row-body"><StreamingMarkdown text={streaming.text} /></div>
        </div>
      )}
      {queued.map((q) => (
        <Fragment key={q.id}>
        <MessageTime ms={q.sentAt} />
        <div className="chat-user chat-queued" data-testid="chat-queued">
          <div className="chat-queued-content">
            <MarkdownText text={q.text} />
          </div>
          <div className="chat-queued-actions">
            <span className="chat-queued-label">Queued</span>
            {chat !== null && <QueuedSendButton sessionId={chat.sessionId} queuedId={q.id} />}
          </div>
        </div>
        </Fragment>
      ))}
      {chat?.permissions.map((p) => (
        <PermissionCard key={p.requestId} request={p} onDecide={(d) => { onDecide(p.requestId, d) }} />
      ))}
      {busy && chat.permissions.length === 0 && (
        <WorkingLine
          since={chat.turnStartedAt}
          thinkingTokens={streaming?.thinking === true ? streaming.thinkingTokens : null}
        />
      )}
      {!chatRunning && terminalBusy && (
        // Seen starting, the line times itself from when it appeared; opened mid-turn, from the
        // prompt that began the turn.
        <WorkingLine since={openedMidTurn ? prompt?.timestampMs ?? null : null} thinkingTokens={null} interruptible={false} />
      )}
      {chat?.status === 'exited' && chat.error !== null && (
        <div className="chat-error" data-testid="chat-error">Claude stopped: {chat.error}</div>
      )}
    </div>
  )
}
