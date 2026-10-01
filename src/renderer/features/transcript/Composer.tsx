import { asSessionId, ptyIdOfSession, type PtyId } from '@shared/domain/ids'
import { type JSX, useCallback, useRef, useState } from 'react'
import {
  isChatPermissionMode,
  type ChatEffort, type ChatPermissionMode, type ChatState,
} from '@shared/domain/chat'
import { ContextRing, ModelPicker } from '../chat/ModelPicker'
import { ModeMenu } from '../chat/ModeMenu'
import { CommandPalette } from '../chat/CommandPalette'
import type { SessionNode } from '@shared/types'
import { useNotifications } from '../../ui/notifications'
import { CloseIcon } from '../../ui/icons'

/** One image waiting to be sent: where it now lives on disk, and a preview of it. */
interface Attachment {
  /** Absolute path — this is what actually reaches Claude, which reads the file itself. */
  path: string
  /**
   * Data URL for the thumbnail. Deliberately not an object URL: the renderer is served from
   * `file://`, and the app's CSP allows images from `self` and `data:` only — a `blob:` preview is
   * silently blocked and renders as a zero-size box. A data URL also needs no revoking.
   */
  previewUrl: string
}

/** Model choices offered by the picker. `null` means "leave whatever the session is using". */
const MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const

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
  /** Send as a chat (the "Chat in the transcript" setting) rather than into the terminal. */
  chatMode?: boolean
  /** The session's chat, when it has one. */
  chat?: ChatState | null
}

/** The mode the picker shows for what Claude reports — it calls Manual `default`. */
function shownMode(reported: string | null | undefined): ChatPermissionMode | '' {
  if (reported === 'default') return 'manual'
  return isChatPermissionMode(reported) ? reported : ''
}

/**
 * The chat box under the transcript.
 *
 * It is not a second conversation: everything typed here is delivered into the very same
 * `claude --resume` process the Session tab shows, as a paste followed by a return. That keeps one
 * source of truth — the session's own JSONL — so the transcript above continues to be a faithful
 * record rather than something this component has to keep in step. It also means an image has to
 * reach Claude the way a file does: pasted images are written to disk, and the message carries
 * their paths for Claude to read.
 */
export function Composer({
  session, ptyId, running, onResume, onShowSession, onOpenImage, chatMode = false, chat = null,
}: Props): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [model, setModel] = useState<(typeof MODELS)[number]>('default')
  // Chosen before the chat has started: used when it starts. Once it runs, Claude's own report wins.
  const [startMode, setStartMode] = useState<ChatPermissionMode | ''>('')
  const [startModel, setStartModel] = useState('default')
  const [startEffort, setStartEffort] = useState<ChatEffort | null>(null)
  const chatRunning = chat !== null && chat.status !== 'exited'
  const busy = chat?.status === 'busy'
  const mode = chatRunning ? shownMode(chat.permissionMode) : startMode
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const addImages = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const base64 = await new Promise<string>((resolvePromise, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          // readAsDataURL gives "data:<type>;base64,<payload>"; only the payload crosses the bridge.
          // `reader.result` is always a string for readAsDataURL (never an ArrayBuffer), but the
          // DOM type covers both, so it is narrowed explicitly rather than blindly stringified.
          reader.onload = () => {
            const result = reader.result
            const text = typeof result === 'string' ? result : ''
            resolvePromise(text.split(',')[1] ?? '')
          }
          reader.readAsDataURL(file)
        })
        const path = await window.apiary.saveImage(base64, file.type)
        setAttachments((prev) => [...prev, { path, previewUrl: `data:${file.type};base64,${base64}` }])
      } catch (e) {
        notifyError(e, 'Could not attach that image')
      }
    }
  }, [notifyError])

  const imagesFrom = (list: DataTransfer | null): File[] =>
    [...(list?.files ?? [])].filter((f) => f.type.startsWith('image/'))

  /** Sends the message box, or — `command`, from the "/" menu — just that command. */
  const send = useCallback(async (command?: string): Promise<void> => {
    const body = command ?? text.trim()
    const images = command === undefined ? attachments : []
    if (body === '' && images.length === 0) return
    setSending(true)
    try {
      // Claude reads an image from its path, so that is what the message carries. One per line,
      // under the prose, so the wording still reads as the sentence it was written as.
      const lines = [body, ...images.map((a) => a.path)].filter((l) => l !== '')
      if (chatMode) {
        // The chat takes the session over from its terminal if one is running: a session runs in
        // one place at a time (main stops the terminal's claude first), and the conversation
        // carries on from the same file. Nothing switches views — the reply streams in above.
        const sessionId = asSessionId(chat?.sessionId ?? session.sessionId)
        if (!chatRunning) {
          await window.apiary.chatStart(sessionId, {
            takeOver: true,
            ...(startModel !== 'default' ? { model: startModel } : {}),
            ...(startMode !== '' ? { permissionMode: startMode } : {}),
            ...(startEffort !== null ? { effort: startEffort } : {}),
          })
        }
        await window.apiary.chatSend(sessionId, lines.join('\n'))
        if (command === undefined) { setText(''); setAttachments([]) }
        return
      }
      let target: PtyId | null = ptyId
      if (!running || target === null) {
        // Resuming is what makes there be anything to type into. Doing it here rather than making
        // the user find the Resume button first is the whole point of a chat box.
        await onResume()
        target = ptyIdOfSession(session.sessionId)
      }
      await window.apiary.sendPrompt(target, lines.join('\n'))
      setText('')
      setAttachments([])
      onShowSession()
    } catch (e) {
      notifyError(e, 'Could not send that message')
    } finally {
      setSending(false)
    }
  }, [text, attachments, ptyId, running, onResume, onShowSession, session.sessionId, notifyError, chatMode, chatRunning, chat?.sessionId, startModel, startMode, startEffort])

  const interrupt = useCallback((): void => {
    void window.apiary.chatInterrupt(asSessionId(chat?.sessionId ?? session.sessionId)).catch((e: unknown) => { notifyError(e, 'Could not stop Claude') })
  }, [chat?.sessionId, session.sessionId, notifyError])

  const chooseMode = useCallback((next: ChatPermissionMode): void => {
    setStartMode(next)
    if (!chatRunning) return
    void window.apiary.chatSetPermissionMode(asSessionId(chat?.sessionId ?? session.sessionId), next)
      .catch((e: unknown) => { notifyError(e, 'Could not change the permission mode') })
  }, [chatRunning, chat?.sessionId, session.sessionId, notifyError])

  const chooseChatModel = useCallback((next: string): void => {
    if (!chatRunning) { setStartModel(next); return }
    void window.apiary.chatSetModel(asSessionId(chat?.sessionId ?? session.sessionId), next)
      .catch((e: unknown) => { notifyError(e, 'Could not switch model') })
  }, [chatRunning, chat?.sessionId, session.sessionId, notifyError])

  const chooseEffort = useCallback((next: ChatEffort): void => {
    if (!chatRunning) { setStartEffort(next); return }
    void window.apiary.chatSetEffort(asSessionId(chat?.sessionId ?? session.sessionId), next)
      .catch((e: unknown) => { notifyError(e, 'Could not change the effort') })
  }, [chatRunning, chat?.sessionId, session.sessionId, notifyError])

  const chooseModel = useCallback(async (next: (typeof MODELS)[number]): Promise<void> => {
    setModel(next)
    if (!running || ptyId === null) return
    try {
      // `/model` is Claude Code's own command; this types it for you rather than reimplementing it.
      await window.apiary.sendPrompt(ptyId, `/model ${next}`)
      notify({ kind: 'info', message: `Asked the session to switch to ${next}.` })
    } catch (e) {
      notifyError(e, 'Could not switch model')
    }
  }, [running, ptyId, notify, notifyError])

  const hint = !chatMode
    ? (running ? 'Goes to the running session' : 'Sending will resume this session first')
    : chatRunning
      ? ''
      : running ? 'Running in its terminal — sending moves it here' : 'Sending resumes this session as a chat'

  return (
    <div className="composer" data-testid="composer">
      {attachments.length > 0 && (
        <div className="composer-attachments" data-testid="composer-attachments">
          {attachments.map((a) => (
            <div key={a.path} className="composer-attachment" data-testid="composer-attachment">
              <button
                className="composer-attachment-preview"
                data-testid="composer-attachment-preview"
                title={`${a.path}\n\nClick to enlarge`}
                onClick={() => onOpenImage(a.previewUrl)}
              >
                <img src={a.previewUrl} alt="" />
              </button>
              <button
                className="composer-attachment-remove"
                data-testid="composer-attachment-remove"
                title="Remove this image"
                aria-label="Remove this image"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
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
          if (e.key === 'Escape' && busy) { e.preventDefault(); interrupt(); return }
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          void send()
        }}
      />

      <div className="composer-actions">
        {chatMode && (
          <CommandPalette
            commands={chatRunning ? chat.commands : null}
            onRun={(command) => { void send(command) }}
            onInsert={(command) => {
              setText(command)
              textareaRef.current?.focus()
            }}
          />
        )}
        {chatMode && chat !== null && chat.contextUsed !== null && chat.contextWindow !== null && chat.contextWindow > 0 && (
          <ContextRing used={chat.contextUsed} window={chat.contextWindow} />
        )}
        {chatMode && (
          <ModelPicker
            model={chatRunning ? chat.model : (startModel === 'default' ? null : startModel)}
            effort={chatRunning ? chat.effort : startEffort}
            models={chatRunning ? chat.models : null}
            onModel={chooseChatModel}
            onEffort={chooseEffort}
          />
        )}
        {!chatMode && <label className="composer-model">
          <span className="muted">Model</span>
          <select
            data-testid="composer-model"
            value={model}
            disabled={!running}
            title={running ? 'Switch this session’s model' : 'Resume the session to change its model'}
            onChange={(e) => { void chooseModel(e.target.value as (typeof MODELS)[number]) }}
          >
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>}
        <span className="composer-hint muted" data-testid="composer-hint">{hint}</span>
        {chatMode && <ModeMenu mode={mode} onMode={chooseMode} />}
        {busy ? (
          <button className="btn composer-send" data-testid="composer-stop" title="Stop Claude (Esc)" onClick={interrupt}>
            Stop
          </button>
        ) : (
          <button
            className="primary composer-send"
            data-testid="composer-send"
            disabled={!session.cwdExists || sending || (text.trim() === '' && attachments.length === 0)}
            onClick={() => { void send() }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        )}
      </div>
    </div>
  )
}
