import type { PtyId, SessionId } from '@shared/domain/ids'
import { type JSX, type KeyboardEvent, type RefObject, useCallback, useRef, useState } from 'react'
import type { ChatState } from '@shared/domain/chat'
import type { SessionNode } from '@shared/types'
import { ContextRing, ModelPicker, ModeMenu, CommandPalette } from '../chat'
import { interruptChat } from '../../state/chatStore'
import { AttachmentStrip, imagesFrom, useImageAttachments } from './composerAttachments'
import { FoldButton, PeekButton, useComposerFold } from './composerFold'
import { ComposerActions } from './ComposerActions'
import { useChatChoices, type ChatChoices } from './useChatChoices'
import { useComposerHeight } from './useComposerHeight'
import { useComposerSend } from './useComposerSend'

interface Props {
  session: SessionNode
  /** The pty this session's `claude` runs under, or null while it has none. */
  ptyId: PtyId | null
  /** Whether that process is actually running — false means the session needs resuming first. */
  running: boolean
  /** Resumes the session; resolves once the pty exists. */
  onResume: () => Promise<void>
  /** Brings the live terminal into view, so a sent message is visibly going somewhere. */
  onShowSession: () => void
  onOpenImage: (src: string) => void
  /** Send as a chat (the "Run sessions as a chat" setting) rather than into the terminal. */
  chatMode?: boolean
  /** The session's chat, when it has one. */
  chat?: ChatState | null
}

interface ChatControlsProps {
  sessionId: SessionId
  chat: ChatState | null
  chatRunning: boolean
  choices: ChatChoices
  text: string
  setText: (text: string) => void
  /** The "/" menu's keys, set while typing "/" has it open. */
  menuKeys: RefObject<((e: KeyboardEvent) => boolean) | null>
  focusInput: () => void
  send: (command?: string) => Promise<void>
}

/** Chat mode's controls before the hint: the "/" menu, the context ring and the model picker. */
function ChatControls(p: ChatControlsProps): JSX.Element {
  const { chat, choices, text } = p
  /** The chat, only while it is running: before that the choices made for its start show. */
  const live = p.chatRunning ? chat : null
  return (
    <>
      <CommandPalette
        sessionId={p.sessionId}
        commands={live !== null ? live.commands : null}
        composerText={text}
        keyHandler={p.menuKeys}
        onRun={(command) => {
          void p.send(command)
          if (text.startsWith('/')) p.setText('')
        }}
        onInsert={(command) => {
          p.setText(command)
          p.focusInput()
        }}
      />
      {chat !== null && chat.contextUsed !== null && chat.contextWindow !== null && chat.contextWindow > 0 && (
        <ContextRing used={chat.contextUsed} window={chat.contextWindow} />
      )}
      <ModelPicker
        model={live !== null ? live.model : (choices.startModel === 'default' ? null : choices.startModel)}
        effort={live !== null ? live.effort : choices.startEffort}
        models={live !== null ? live.models : null}
        onModel={choices.chooseChatModel}
        onEffort={choices.chooseEffort}
      />
    </>
  )
}

/**
 * The chat box under the transcript.
 *
 * It is not a second conversation: everything typed here is delivered into the very same
 * `claude --resume` process the Terminal tab shows, as a paste followed by a return. That keeps one
 * source of truth — the session's own JSONL — so the transcript above continues to be a faithful
 * record rather than something this component has to keep in step. It also means an image has to
 * reach Claude the way a file does: pasted images are written to disk, and the message carries
 * their paths for Claude to read.
 */
export function Composer({
  session, ptyId, running, onResume, onShowSession, onOpenImage, chatMode = false, chat = null,
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const chatRunning = chat !== null && chat.status !== 'exited'
  const busy = chat?.status === 'busy'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fold = useComposerFold(textareaRef)
  const { collapsed, inputId } = fold
  /** The "/" menu's keys, set while typing "/" has it open; it sees Up/Down/Enter/Escape first. */
  const menuKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null)
  const { dragging, separatorProps, fitAgain } = useComposerHeight(textareaRef, text, !collapsed)
  const { attachments, addImages, removeImage, clear } = useImageAttachments()
  const choices = useChatChoices(chat, chatRunning, session.sessionId)
  const onSent = useCallback(() => { setText(''); clear() }, [clear])
  const { sending, send } = useComposerSend({
    session, ptyId, running, onResume, onShowSession, chatMode, chat, chatRunning, choices, text, attachments, onSent,
  })

  const interrupt = useCallback((): void => {
    interruptChat(chat?.sessionId ?? session.sessionId)
  }, [chat?.sessionId, session.sessionId])

  const hint = !chatMode
    ? (running ? 'Goes to the running session' : 'Sending will resume this session first')
    : chatRunning
      ? ''
      : running
        ? 'Running in its terminal — sending moves it here once Claude is idle'
        : 'Sending resumes this session as a chat'

  return (
    <div className="composer" data-testid="composer">
      {!collapsed && (
        <div
          className="composer-resize"
          data-testid="composer-resize"
          data-dragging={dragging}
          title="Drag to resize · double-click to fit the text again"
          {...separatorProps}
          onDoubleClick={fitAgain}
        />
      )}
      {!collapsed && attachments.length > 0 && (
        <AttachmentStrip attachments={attachments} onOpenImage={onOpenImage} onRemove={removeImage} />
      )}

      {!collapsed && <textarea
        ref={textareaRef}
        id={inputId}
        className="composer-input"
        data-testid="composer-input"
        rows={3}
        placeholder={
          !session.cwdExists
            ? 'This session’s folder no longer exists'
            : busy
              ? 'Queue another message… (Esc to interrupt)'
              : 'Message Claude — paste an image, Enter to send, Shift+Enter for a new line'
        }
        disabled={!session.cwdExists || sending}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const images = imagesFrom(e.clipboardData)
          if (images.length === 0) return
          // Only swallow the paste when it actually carried an image; pasting text must still work.
          e.preventDefault()
          void addImages(images)
        }}
        onDragOver={(e) => { if (imagesFrom(e.dataTransfer).length > 0) e.preventDefault() }}
        onDrop={(e) => {
          const images = imagesFrom(e.dataTransfer)
          if (images.length === 0) return
          e.preventDefault()
          void addImages(images)
        }}
        onKeyDown={(e) => {
          if (chatMode && menuKeys.current?.(e) === true) { e.preventDefault(); return }
          if (e.key === 'Escape' && busy) { e.preventDefault(); interrupt(); return }
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          void send()
        }}
      />}

      <ComposerActions
        ptyId={ptyId}
        running={running}
        chatMode={chatMode}
        busy={busy}
        hint={hint}
        leading={<FoldButton fold={fold} />}
        peek={collapsed ? <PeekButton fold={fold} draft={text} /> : null}
        chatControls={chatMode && (
          <ChatControls
            sessionId={session.sessionId}
            chat={chat}
            chatRunning={chatRunning}
            choices={choices}
            text={text}
            setText={setText}
            menuKeys={menuKeys}
            focusInput={() => { textareaRef.current?.focus() }}
            send={send}
          />
        )}
        modeMenu={chatMode && <ModeMenu mode={choices.mode} onMode={choices.chooseMode} />}
        sendDisabled={!session.cwdExists || sending || (text.trim() === '' && attachments.length === 0)}
        sending={sending}
        send={() => { void send() }}
        interrupt={interrupt}
      />
    </div>
  )
}
