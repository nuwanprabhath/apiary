import { type RefObject, useEffect, useRef } from 'react'

interface Options {
  /** Listen only while this is true (a menu that is open). Default true. */
  enabled?: boolean
  /** Elements that count as inside: a press on them, or anything in them, does not dismiss. */
  inside?: ReadonlyArray<RefObject<Element | null>>
  /** A selector for more elements that count as inside — for a layer rendered through a portal
   *  (a submenu in `document.body`), which `contains` on a ref cannot see because it is not a DOM
   *  descendant of the ref'd element. */
  insideSelector?: string
}

/**
 * Calls `onDismiss` for a press anywhere outside `inside` / `insideSelector` — the click-outside
 * half of a popup, next to `useEscape` for the keyboard half. The one place this is written; six
 * copies had drifted on which event, which phase and what "inside" means.
 *
 * - **On press, not on click**: a press on some other button dismisses the popup and still lets
 *   that button's click through, because the popup is already gone when the click completes.
 * - **Capture phase on the document**: a handler further down that calls `stopPropagation` on its
 *   own pointerdown (a draggable pet, a tab strip) cannot hide the press from here.
 * - **Pointer events**: one event for mouse, pen and touch. A resize handle that cancels the
 *   pointerdown to keep text selection from starting suppresses the compatibility `mousedown`, but
 *   not this.
 * - **Portals**: name the portalled layer with `insideSelector`, since DOM containment does not
 *   follow React's tree.
 *
 * `onDismiss` is read through a ref, so an inline arrow does not re-subscribe on every render.
 */
export function useOutsideDismiss(onDismiss: () => void, options: Options = {}): void {
  const { enabled = true, inside = [], insideSelector } = options
  const latest = useRef({ onDismiss, inside, insideSelector })
  latest.current = { onDismiss, inside, insideSelector }

  useEffect(() => {
    if (!enabled) return
    const onDown = (e: PointerEvent): void => {
      const { inside: refs, insideSelector: selector, onDismiss: dismiss } = latest.current
      const target = e.target
      if (target instanceof Node) {
        if (refs.some((ref) => ref.current?.contains(target) === true)) return
        const element = target instanceof Element ? target : target.parentElement
        const hit = selector === undefined ? null : element?.closest(selector)
        if (hit !== null && hit !== undefined) return
      }
      dismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => { document.removeEventListener('pointerdown', onDown, true) }
  }, [enabled])
}
