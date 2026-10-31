import { type JSX, useLayoutEffect, useRef } from 'react'
import { writeResidentDraft } from '../../state/uiState'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

/**
 * The popup's message box: Enter sends, Shift+Enter is a newline, 1 to 6 lines tall. The draft is
 * the parent's (examples fill it) and saved per resident as it changes.
 */
export function ResidentComposer({ residentId, name, draft, onDraft, onSend }: {
  residentId: string
  name: string
  draft: string
  onDraft: (text: string) => void
  onSend: (text: string) => void
}): JSX.Element {
  const box = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    // Grows with its text; the stylesheet's max-height stops it at six lines, and it scrolls after.
    el.style.height = 'auto'
    el.style.height = `${String(el.scrollHeight + el.offsetHeight - el.clientHeight)}px`
  }, [draft])
  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    onSend(text)
    onDraft('')
    writeResidentDraft(residentId, '')
  }
  return (
    <div className="resident-popup-composer">
      <textarea
        ref={(el) => { box.current = el; focusAskedFor(el) }}
        className="resident-popup-input"
        rows={1}
        placeholder={`Ask ${name}…`}
        aria-label={`Ask ${name}`}
        value={draft}
        onChange={(e) => { onDraft(e.target.value); writeResidentDraft(residentId, e.target.value) }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          send()
        }}
      />
      <button type="button" className="btn primary small" disabled={draft.trim() === ''} onClick={send}>Send</button>
    </div>
  )
}
