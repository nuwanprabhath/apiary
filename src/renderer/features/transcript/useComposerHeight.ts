import { type RefObject, useLayoutEffect, useState } from 'react'
import { useResizeDrag } from '../../ui/useResizeDrag'
import { loadComposerHeight, saveComposerHeight } from '../../state/uiState'

/** The box's height when empty, and how tall it grows with what is typed (a share of the window)
 *  before it scrolls instead — unless dragged taller, up to `MAX_SHARE`. */
const MIN_HEIGHT = 58
const GROW_SHARE = 0.4
const MAX_SHARE = 0.75

/** The message box's height: fitted to its text, or dragged (and remembered) taller. */
export function useComposerHeight(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  text: string,
  /** False while the box is folded away: it is measured again when it comes back. */
  shown: boolean,
): { dragging: boolean, separatorProps: ReturnType<typeof useResizeDrag>['separatorProps'], fitAgain: () => void } {
  // The height the box was dragged to, which it never shrinks below; null to fit what is typed.
  const [dragged, setDragged] = useState<number | null>(() => loadComposerHeight(MIN_HEIGHT))

  // Fits the box to its text, so a long message can be read whole before it is sent: from the
  // dragged height (or the minimum) up to a share of the window, scrolling only past that.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (el === null) return
    const floor = dragged ?? MIN_HEIGHT
    const cap = Math.max(floor, window.innerHeight * GROW_SHARE)
    el.style.height = 'auto'
    el.style.height = `${String(Math.min(cap, Math.max(floor, el.scrollHeight + 2)))}px`
  }, [textareaRef, text, dragged, shown])

  // The top edge drags the box taller (up grows it) and, with the keyboard, steps it the same way.
  // The height is committed — and saved — once, on release or key press; `onLive` only moves the
  // local state the box already renders from.
  const { dragging, separatorProps } = useResizeDrag({
    axis: 'row',
    value: dragged ?? MIN_HEIGHT,
    min: MIN_HEIGHT,
    max: Math.round(window.innerHeight * MAX_SHARE),
    label: 'Resize the message box',
    grows: 'back',
    // From what the box measures now: before it is dragged it is sized to fit its text.
    initial: () => textareaRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT,
    measure: (e, start) =>
      Math.round(Math.min(window.innerHeight * MAX_SHARE, Math.max(MIN_HEIGHT, start.value + start.y - e.clientY))),
    onLive: setDragged,
    onEnd: (height) => {
      setDragged(height)
      saveComposerHeight(height)
    },
  })

  return {
    dragging,
    separatorProps,
    fitAgain: () => {
      setDragged(null)
      saveComposerHeight(null)
    },
  }
}
