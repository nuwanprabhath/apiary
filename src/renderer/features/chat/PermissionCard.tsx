import { type JSX, useEffect, useRef, useState } from 'react'
import type { ChatDecision, ChatPermissionRequest } from '@shared/domain/chat'
import { describeTool } from '@shared/chatTimeline'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'

/**
 * Claude asking to use a tool, in the conversation where it asked — the extension's permission
 * prompt. "Yes", "Yes, don't ask again" (when Claude offered a rule for it), or "No" with an
 * optional note telling Claude what to do instead. The first button takes focus, so Enter allows,
 * unless you are typing: the card can arrive at any moment, and the Enter meant to send your message
 * must not approve a tool. Then it is announced (`role="alert"`) and reached with Tab instead.
 */
export function PermissionCard(
  { request, onDecide }: { request: ChatPermissionRequest; onDecide: (decision: ChatDecision) => void },
): JSX.Element {
  const described = describeTool(request.toolName, request.input)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  const allowRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { focusUnlessTyping(allowRef.current) }, [])

  return (
    <div className="chat-permission" data-testid="chat-permission" role="alert" aria-label={`Allow ${request.toolName}?`}>
      <div className="chat-permission-title">
        Allow <strong>{request.toolName}</strong>{request.description !== '' ? ` — ${request.description}` : ''}?
      </div>
      <pre className="chat-io-text chat-permission-input">{described.input}</pre>
      {denying ? (
        <form
          className="chat-permission-deny"
          onSubmit={(e) => { e.preventDefault(); onDecide({ behavior: 'deny', message: reason }) }}
        >
          <input
            className="chat-permission-reason"
            data-testid="chat-permission-reason"
            // eslint-disable-next-line apiary/focus-unless-typing -- the user just clicked "No…" to write this note, so the field is what they asked for
            autoFocus
            placeholder="Tell Claude what to do instead (optional)"
            value={reason}
            onChange={(e) => { setReason(e.target.value) }}
          />
          <button type="submit" className="btn danger small" data-testid="chat-permission-deny-send">No</button>
        </form>
      ) : (
        <div className="chat-permission-actions">
          <button ref={allowRef} className="btn primary small" data-testid="chat-permission-allow" onClick={() => { onDecide({ behavior: 'allow' }) }}>
            Yes
          </button>
          {request.canAlwaysAllow && (
            <button className="btn small" data-testid="chat-permission-always" onClick={() => { onDecide({ behavior: 'allow', always: true }) }}>
              Yes, don&apos;t ask again
            </button>
          )}
          <button className="btn small" data-testid="chat-permission-deny" onClick={() => { setDenying(true) }}>
            No…
          </button>
        </div>
      )}
    </div>
  )
}
