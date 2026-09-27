import { useEffect, useRef } from 'react'

/**
 * The minimal surface `registerEscapeLayer` needs from `document` — narrowed so the stack logic
 * below can be driven by a fake in a unit test without touching a real DOM.
 */
export interface EscapeEventTarget {
  addEventListener: (type: 'keydown', listener: (e: KeyboardEvent) => void) => void
  removeEventListener: (type: 'keydown', listener: (e: KeyboardEvent) => void) => void
}

// Every open dialog, menu and popup shares this one LIFO stack instead of each hand-rolling its
// own document-level `keydown` listener (UI-13). Only the top of the stack — whichever layer was
// registered most recently — reacts to Escape, so an inner popup opened from within a dialog (a
// menu, a picker) closes on Escape without also closing the dialog behind it. Nine copies of
// `if (e.key !== 'Escape') return` on the same node could never guarantee that: `stopPropagation`
// only stops an event travelling further up the tree, not other listeners already bound to the
// node it fires on, so two layers both closed at once (the bug this replaces).
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
 * Exported apart from the `useEscape` hook below so the stack behaviour itself — which layer wins
 * when several are open — can be unit-tested against a fake `EscapeEventTarget`, without mounting
 * React or a real document.
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
 * is mounted and `enabled` is true. Replaces the hand-written `document.addEventListener('keydown',
 * ...)` that used to live in ContextMenu, GitMenu, LayoutPicker, BranchSwitcher, NoteDialog,
 * SettingsDialog, ImportDialog and ImageLightbox (UI-13).
 */
export function useEscape(onEscape: () => void, options?: { enabled?: boolean }): void {
  const enabled = options?.enabled ?? true
  // `onEscape` is very often a fresh arrow function on every render (an inline `() => onClose()`),
  // so it cannot honestly sit in the effect's deps without tearing the layer down and rebuilding it
  // — and therefore moving it to the top of the stack — on every render of the owning component. A
  // ref kept current on every render, read only from inside the registered callback, is the
  // standard way to always call the latest version without that.
  const callbackRef = useRef(onEscape)
  callbackRef.current = onEscape

  useEffect(() => {
    if (!enabled) return
    return registerEscapeLayer(() => { callbackRef.current() })
  }, [enabled])
}
