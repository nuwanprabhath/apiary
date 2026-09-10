import { useCallback, useRef, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { useNotifications } from '../state/notifications'
import { CloseIcon } from './icons'

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
  ptyId: string | null
  /** Whether that process is actually running — false means the session needs resuming first. */
  running: boolean
  /** Resumes the session; resolves once the pty exists. */
  onResume: () => Promise<void>
  /** Brings the live terminal into view, so a sent message is visibly going somewhere. */
  onShowSession: () => void
  onOpenImage: (src: string) => void
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
  session, ptyId, running, onResume, onShowSession, onOpenImage,
}: Props): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [model, setModel] = useState<(typeof MODELS)[number]>('default')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const addImages = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const base64 = await new Promise<string>((resolvePromise, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          // readAsDataURL gives "data:<type>;base64,<payload>"; only the payload crosses the bridge.
          reader.onload = () => resolvePromise(String(reader.result).split(',')[1] ?? '')
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

  const send = useCallback(async (): Promise<void> => {
    const body = text.trim()
    if (body === '' && attachments.length === 0) return
    setSending(true)
    try {
      let target = ptyId
      if (!running || target === null) {
        // Resuming is what makes there be anything to type into. Doing it here rather than making
        // the user find the Resume button first is the whole point of a chat box.
        await onResume()
        target = session.sessionId
      }
      // Claude reads an image from its path, so that is what the message carries. One per line,
      // under the prose, so the wording still reads as the sentence it was written as.
      const lines = [body, ...attachments.map((a) => a.path)].filter((l) => l !== '')
      await window.apiary.sendPrompt(target, lines.join('\n'))
      setText('')
      setAttachments([])
      onShowSession()
    } catch (e) {
      notifyError(e, 'Could not send that message')
    } finally {
      setSending(false)
    }
  }, [text, attachments, ptyId, running, onResume, onShowSession, session.sessionId, notifyError])

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
          session.cwdExists
            ? 'Message Claude — paste an image, Enter to send, Shift+Enter for a new line'
            : 'This session’s folder no longer exists'
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
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          void send()
        }}
      />

      <div className="composer-actions">
        <label className="composer-model">
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
        </label>
        <span className="composer-hint muted" data-testid="composer-hint">
          {running ? 'Goes to the running session' : 'Sending will resume this session first'}
        </span>
        <button
          className="primary composer-send"
          data-testid="composer-send"
          disabled={!session.cwdExists || sending || (text.trim() === '' && attachments.length === 0)}
          onClick={() => { void send() }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
