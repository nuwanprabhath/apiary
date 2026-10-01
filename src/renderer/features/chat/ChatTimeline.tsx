import { type JSX, memo, useState } from 'react'
import type { ChatDecision, ChatState } from '@shared/domain/chat'
import { lastPrompt, type ChatItem } from '@shared/chatTimeline'
import { TextBlock } from '../transcript/MessageRow'
import { ImageThumbnail } from '../transcript/TranscriptImage'
import { MarkdownText } from '../transcript/MarkdownText'
import { ToolCall } from './ToolCall'
import { PermissionCard } from './PermissionCard'
import { WorkingLine } from './WorkingLine'

interface Props {
  items: ChatItem[]
  /** The session's chat, when it has run as one this launch — for what is live right now. */
  chat: ChatState | null
  onOpenImage: (src: string) => void
  onDecide: (requestId: string, decision: ChatDecision) => void
}

const Thought = memo(function Thought(
  { text, timing }: { text: string; timing: { seconds: number; tokens: number | null } | undefined },
): JSX.Element {
  const [open, setOpen] = useState(false)
  const label = timing === undefined
    ? 'Thought'
    : `Thought for ${String(timing.seconds)}s${timing.tokens !== null ? ` · ${timing.tokens.toLocaleString()} tokens` : ''}`
  // Claude Code keeps only a signature for most thinking, not the text, so there is often nothing
  // to expand into; the row then just says that Claude thought, and for how long.
  const hasText = text.trim() !== ''
  return (
    <div className="chat-row chat-thought" data-testid="chat-thought">
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

function Item({ item, chat, onOpenImage }: { item: ChatItem; chat: ChatState | null; onOpenImage: (src: string) => void }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-user" data-testid="chat-user" data-key={item.key}>
          <TextBlock text={item.text} onOpenImage={onOpenImage} />
          {item.images.map((src) => <ImageThumbnail key={src.slice(-32)} src={src} onOpen={onOpenImage} />)}
        </div>
      )
    case 'text':
      return (
        <div className="chat-row chat-text" data-testid="chat-text">
          <span className="chat-dot" aria-hidden="true" />
          <div className="chat-row-body"><TextBlock text={item.text} onOpenImage={onOpenImage} /></div>
        </div>
      )
    case 'thinking':
      return <Thought text={item.text} timing={chat?.thoughts[item.uuid]} />
    case 'tool':
      return <ToolCall name={item.name} input={item.input} result={item.result} />
    case 'interrupted':
      return <div className="chat-interrupted" data-testid="chat-interrupted">Interrupted — tell Claude what to do instead.</div>
  }
}

/**
 * The transcript drawn as the VS Code extension draws a conversation (the "Chat in the transcript"
 * setting). Everything above the live part comes from the session's JSONL, so it looks the same
 * whether or not the session is running; the live part — the reply being written, permission
 * prompts, the working line — comes from the chat process.
 */
export function ChatTimeline({ items, chat, onOpenImage, onDecide }: Props): JSX.Element {
  const prompt = lastPrompt(items)
  const streaming = chat?.streaming ?? null
  const busy = chat?.status === 'busy'
  return (
    <div className="chat-timeline" data-testid="chat-timeline">
      {prompt !== null && (
        // Stays at the top while the conversation scrolls under it, so whatever you are reading is
        // always in the light of what you asked. Clicking it goes back to where you asked it.
        <button
          className="chat-sticky-prompt"
          data-testid="chat-sticky-prompt"
          title="Go to this message"
          onClick={(e) => {
            const target = e.currentTarget.closest('.chat-timeline')?.querySelector(`[data-key="${CSS.escape(prompt.key)}"]`)
            target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}
        >
          {prompt.text}
        </button>
      )}
      {items.map((item) => <Item key={item.key} item={item} chat={chat} onOpenImage={onOpenImage} />)}
      {streaming !== null && streaming.text !== '' && (
        <div className="chat-row chat-text chat-streaming" data-testid="chat-streaming">
          <span className="chat-dot" aria-hidden="true" />
          <div className="chat-row-body"><MarkdownText text={streaming.text} /></div>
        </div>
      )}
      {chat?.permissions.map((p) => (
        <PermissionCard key={p.requestId} request={p} onDecide={(d) => { onDecide(p.requestId, d) }} />
      ))}
      {busy && chat.permissions.length === 0 && (
        <WorkingLine
          since={chat.turnStartedAt}
          thinkingTokens={streaming?.thinking === true ? streaming.thinkingTokens : null}
        />
      )}
      {chat?.status === 'exited' && chat.error !== null && (
        <div className="chat-error" data-testid="chat-error">Claude stopped: {chat.error}</div>
      )}
    </div>
  )
}
