import type { SessionId } from '@shared/domain/ids'
import { sentPrompts } from '@shared/chatTimeline'
import { type KeyboardEvent, useCallback, useRef } from 'react'
import { loadTranscript } from '../../state/transcript'
import { caretOnFirstLine, caretOnLastLine } from '../../ui/caretLine'
import { logBackgroundFailure } from '../../ui/fireAndForget'

/** How far into the session's history a message sent from this box is looked for before it is
 *  listed again on its own: the session file can lag the send by a moment. */
const SENT_LOOKBACK = 10

export interface SentHistory {
  /** Up and Down as a shell's history: true when the key was taken. */
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** A message went out from this box. */
  sent: (text: string) => void
  /** The person typed: the next Up starts from the newest again, keeping what they typed. */
  edited: () => void
}

/**
 * The message box's history: Up on the first line goes back through what you sent to this
 * session, Down on the last line comes forward, and past the newest the draft you had comes back.
 * Read from the session's own file each time browsing starts (its latest page, as the transcript
 * shows it), so it holds what was sent from the terminal, a chat, or another window too.
 */
export function useSentHistory(sessionId: SessionId, setText: (text: string) => void): SentHistory {
  const entries = useRef<string[]>([])
  /** Which entry shows; -1 while not browsing. */
  const at = useRef(-1)
  const draft = useRef('')
  /** Sent from this box, newest first, until the session file is seen to hold them. */
  const local = useRef<string[]>([])

  const start = useCallback((current: string): void => {
    draft.current = current
    loadTranscript(sessionId).then((page) => {
      const fromFile = sentPrompts(page.messages)
      const recent = new Set(fromFile.slice(0, SENT_LOOKBACK))
      local.current = local.current.filter((t) => !recent.has(t))
      entries.current = [...local.current, ...fromFile]
      if (entries.current.length === 0) return
      at.current = 0
      setText(entries.current[0])
    }, (error: unknown) => { logBackgroundFailure(error, 'prompt') })
  }, [sessionId, setText])

  const onKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return false
    const box = e.currentTarget
    if (box.selectionStart !== box.selectionEnd) return false
    if (e.key === 'ArrowUp') {
      // Only from the first visual line: further down, Up moves the caret through the message itself.
      if (!caretOnFirstLine(box)) return false
      if (at.current === -1) start(box.value)
      else if (at.current < entries.current.length - 1) setText(entries.current[++at.current])
      return true
    }
    if (at.current === -1 || !caretOnLastLine(box)) return false
    at.current -= 1
    setText(at.current === -1 ? draft.current : entries.current[at.current])
    return true
  }, [setText, start])

  const sent = useCallback((text: string): void => {
    at.current = -1
    if (text.trim() !== '' && text !== local.current[0]) local.current.unshift(text)
  }, [])
  const edited = useCallback((): void => { at.current = -1 }, [])

  return { onKey, sent, edited }
}
