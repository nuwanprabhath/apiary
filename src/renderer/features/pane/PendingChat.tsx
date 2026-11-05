import { lastPathSegment } from '@shared/text'
import { type JSX, useState } from 'react'
import { sendPrompt } from '../../state/terminals'
import { describeError } from '../../ui/errors'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import type { PendingTabInfo } from './paneTypes'

/**
 * The Chat tab of a session started from "+" with "Open new sessions in the chat" on. Claude runs
 * in the session's terminal, which has no transcript yet, so the first message is typed into that
 * terminal; once Claude has written the session, the tab follows it and shows the chat.
 */
export function PendingChat({ info, onShowTerminal }: { info: PendingTabInfo; onShowTerminal: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const folder = lastPathSegment(info.cwd) || info.cwd
  const send = async (): Promise<void> => {
    const message = text.trim()
    if (message === '' || sent) return
    setSent(true)
    setError(null)
    try {
      await sendPrompt(info.ptyId, message)
      setText('')
    } catch (e) {
      setSent(false)
      setError(describeError(e).message)
    }
  }
  return (
    <div className="pane-fill" data-testid="pending-chat">
      <div className="pending-chat-intro">
        <h2 className="pending-chat-title">New session in {folder}</h2>
        <p className="pending-chat-help" data-testid="pending-chat-help">
          {sent
            ? 'Sent. Claude is starting the conversation, and it will show here.'
            : 'Write your first message to start it. If Claude asks something first, such as whether to trust this folder, answer it in the terminal.'}
        </p>
        <button type="button" className="btn small" data-testid="pending-chat-terminal" onClick={onShowTerminal}>
          Show the terminal
        </button>
        {error !== null && <p className="pending-chat-error" role="alert">{error}</p>}
      </div>
      <form
        className="composer"
        onSubmit={(e) => { e.preventDefault(); void send() }}
      >
        <textarea
          ref={focusAskedFor}
          className="composer-input"
          data-testid="pending-chat-input"
          aria-label="First message to Claude"
          placeholder="Message Claude — Enter to send, Shift+Enter for a new line"
          value={text}
          disabled={sent}
          onChange={(e) => { setText(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            void send()
          }}
        />
        <div className="pending-chat-actions">
          <button type="submit" className="btn primary small" data-testid="pending-chat-send" disabled={sent || text.trim() === ''}>
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
