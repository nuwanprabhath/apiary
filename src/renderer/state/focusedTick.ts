/** How often a focused window re-reads what main cannot tell it has changed. */
const FOCUSED_TICK_MS = 5000

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Calls `cb` every few seconds while this window has focus, until the returned function is called.
 * For state that changes outside Apiary's sight (a `git checkout` typed into a terminal), where
 * there is no push to listen for. One timer serves every subscriber, however many panes ask, and
 * it stops when the last one leaves; an unfocused window costs nothing.
 */
export function onFocusedTick(cb: () => void): () => void {
  listeners.add(cb)
  timer ??= setInterval(() => {
    if (!document.hasFocus()) return
    for (const listener of [...listeners]) listener()
  }, FOCUSED_TICK_MS)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer !== null) { clearInterval(timer); timer = null }
  }
}
