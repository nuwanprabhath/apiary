import { useEffect, useRef } from 'react'

/**
 * The minimal surface `registerEscapeLayer` needs from `document` — narrowed so the stack logic
 * below can be driven by a fake in a unit test without touching a real DOM.
 */
export interface EscapeEventTarget {
  addEventListener: (type: 'keydown', listener: (e: KeyboardEvent) => void) => void
  removeEventListener: (type: 'keydown', listener: (e: KeyboardEvent) => void) => void
}

// Every open dialog, menu and popup shares this one LIFO stack. Only the top — the layer
// registered most recently — reacts to Escape, so an inner popup closes without also closing the
// dialog behind it. Separate listeners could not guarantee that: `stopPropagation` does not stop
// other listeners already bound to the same node.
const stack: Array<() => void> = []
let attachedTarget: EscapeEventTarget | null = null

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (top === undefined) return
  e.stopPropagation()
  top()
}

/**
 * Pushes `onEscape` onto the shared stack and returns the function that pops it back off.
 * Exported apart from `useEscape` so the stack can be unit-tested against a fake `EscapeEventTarget`.
 */
export function registerEscapeLayer(
  onEscape: () => void,
  target: EscapeEventTarget = document,
): () => void {
  if (stack.length === 0) {
    target.addEventListener('keydown', handleKeyDown)
    attachedTarget = target
  }
  stack.push(onEscape)
  return () => {
    const index = stack.lastIndexOf(onEscape)
    if (index !== -1) stack.splice(index, 1)
    if (stack.length === 0 && attachedTarget !== null) {
      attachedTarget.removeEventListener('keydown', handleKeyDown)
      attachedTarget = null
    }
  }
}

/**
 * Registers `onEscape` as a layer on the shared Escape stack for as long as the calling component
 * is mounted and `enabled` is true.
 */
export function useEscape(onEscape: () => void, options?: { enabled?: boolean }): void {
  const enabled = options?.enabled ?? true
  // `onEscape` is often a fresh arrow every render; in the effect's deps it would rebuild the
  // layer, moving it to the top of the stack, on every render. A ref calls the latest version.
  const callbackRef = useRef(onEscape)
  callbackRef.current = onEscape

  useEffect(() => {
    if (!enabled) return
    return registerEscapeLayer(() => { callbackRef.current() })
  }, [enabled])
}
