import { type JSX, useEffect, useLayoutEffect, useRef } from 'react'
import { writeResidentDraft } from '../../state/uiState'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { AttachmentStrip, imagesFrom, useImageAttachments } from '../transcript'

/**
 * The popup's message box: Enter sends, Shift+Enter is a newline, 1 to 6 lines tall. The draft is
 * the parent's (examples fill it) and saved per resident as it changes. Images pasted or dropped
 * are saved to disk and go as their paths on the lines after the text, like the main composer's.
 * The box takes focus when it first appears and when `focusTick` changes, never on a re-render.
 */
export function ResidentComposer({ residentId, name, draft, focusTick, onDraft, onSend, onOpenImage }: {
  residentId: string
  name: string
  draft: string
  focusTick: number
  onDraft: (text: string) => void
  onSend: (text: string) => void
  onOpenImage: (src: string) => void
}): JSX.Element {
  const box = useRef<HTMLTextAreaElement | null>(null)
  const { attachments, addImages, removeImage, clear } = useImageAttachments()
  useEffect(() => { focusAskedFor(box.current) }, [focusTick])
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    // Grows with its text; the stylesheet's max-height stops it at six lines, and it scrolls after.
    el.style.height = 'auto'
    el.style.height = `${String(el.scrollHeight + el.offsetHeight - el.clientHeight)}px`
  }, [draft])
  const send = (): void => {
    const body = draft.trim()
    if (body === '' && attachments.length === 0) return
    onSend([body, ...attachments.map((a) => a.path)].filter((l) => l !== '').join('\n'))
    clear()
    onDraft('')
    writeResidentDraft(residentId, '')
  }
  const take = (list: DataTransfer | null, e: { preventDefault: () => void }): void => {
    const images = imagesFrom(list)
    if (images.length === 0) return
    e.preventDefault()
    void addImages(images)
  }
  return (
    <>
      {attachments.length > 0 && (
        <div className="resident-popup-attachments">
          <AttachmentStrip attachments={attachments} onOpenImage={onOpenImage} onRemove={removeImage} />
        </div>
      )}
      <div className="resident-popup-composer">
        <textarea
          ref={box}
          className="resident-popup-input"
          rows={1}
          placeholder={`Ask ${name}… (paste an image to attach it)`}
          aria-label={`Ask ${name}`}
          value={draft}
          onChange={(e) => { onDraft(e.target.value); writeResidentDraft(residentId, e.target.value) }}
          onPaste={(e) => { take(e.clipboardData, e) }}
          onDragOver={(e) => { if (imagesFrom(e.dataTransfer).length > 0) e.preventDefault() }}
          onDrop={(e) => { take(e.dataTransfer, e) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        <button type="button" className="btn primary small" disabled={draft.trim() === '' && attachments.length === 0} onClick={send}>Send</button>
      </div>
    </>
  )
}
