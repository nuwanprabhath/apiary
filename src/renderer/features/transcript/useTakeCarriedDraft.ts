import { type RefObject, useEffect, useRef } from 'react'
import { useCarriedDraft } from '../../state/carryTypedInput'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'

/**
 * Puts text carried from the session's terminal (`carryTerminalInput`) into the composer, with
 * the caret at its end. The carried text arrives on its own, after the view switched, so it takes
 * focus only if no other text field has it.
 */
export function useTakeCarriedDraft(
  sessionId: string,
  setText: (text: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): void {
  const carried = useCarriedDraft(sessionId)
  // A composer mounted after a carry already has it in its draft, and may have been edited since.
  const seenAtMount = useRef(carried?.seq ?? 0)
  useEffect(() => {
    if (carried === null || carried.seq <= seenAtMount.current) return
    setText(carried.text)
    const frame = requestAnimationFrame(() => {
      const box = textareaRef.current
      if (box === null) return
      box.setSelectionRange(box.value.length, box.value.length)
      focusUnlessTyping(box)
    })
    return () => { cancelAnimationFrame(frame) }
  }, [carried, setText, textareaRef])
}
