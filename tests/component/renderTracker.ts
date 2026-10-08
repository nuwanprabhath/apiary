/**
 * Counts how often a named component function actually renders, per pane, by listening to React's
 * own commit notifications (the DevTools hook) — the one place a render caused by a context or
 * store change is visible. Props identity (what `appPropStability` compares) cannot see it: a
 * `memo` component that re-renders for a context it reads keeps the very same props object.
 *
 * The hook has to be installed before `react-dom` first loads, so `setup.ts` imports this file
 * first. It is inert until a test calls `trackRenders`.
 *
 * How a render is told from a bailout: React resets a fiber's flags when it clones it for a new
 * render, and sets `PerformedWork` only when the function body actually ran. A fiber that was not
 * cloned at all in a commit keeps its old flags, so a fiber object seen at the previous commit is
 * skipped.
 */

interface Fiber {
  type: unknown
  flags: number
  child: Fiber | null
  sibling: Fiber | null
  memoizedProps: Record<string, unknown> | null
}

const PERFORMED_WORK = 1

interface Tracking {
  componentName: string
  /** Renders per `data-column-id` of the section the component renders. */
  counts: Map<string, number>
  seen: Map<string, Fiber>
}

let tracking: Tracking | null = null
/** The newest committed tree, so a tracker can note the fibers already there when it starts. */
let latest: Fiber | null = null

function paneIdOf(fiber: Fiber): string | null {
  const root = fiber.child?.memoizedProps
  const id = root?.['data-column-id']
  return typeof id === 'string' ? id : null
}

function visit(fiber: Fiber | null, t: Tracking): void {
  for (let f = fiber; f !== null; f = f.sibling) {
    if (typeof f.type === 'function' && (f.type as { name: string }).name === t.componentName) {
      const id = paneIdOf(f)
      if (id !== null) {
        const previous = t.seen.get(id)
        if (previous !== f && (f.flags & PERFORMED_WORK) !== 0) t.counts.set(id, (t.counts.get(id) ?? 0) + 1)
        t.seen.set(id, f)
      }
    }
    visit(f.child, t)
  }
}

const hook = {
  supportsFiber: true,
  isDisabled: false,
  renderers: new Map<number, unknown>(),
  inject(renderer: unknown): number {
    hook.renderers.set(1, renderer)
    return 1
  },
  checkDCE(): void { /* production-build check; nothing to do */ },
  onScheduleFiberRoot(): void { /* not needed */ },
  onCommitFiberUnmount(): void { /* not needed */ },
  onPostCommitFiberRoot(): void { /* not needed */ },
  onCommitFiberRoot(_id: number, root: { current: Fiber }): void {
    latest = root.current
    if (tracking !== null) visit(root.current, tracking)
  },
}

const host = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
host.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= hook

/** Starts counting renders of every mounted `componentName` (found by its function name). Returns
 *  the counts per pane id since this call; `read()` snapshots, `stop()` ends it. */
export function trackRenders(componentName: string): {
  read: () => Map<string, number>
  stop: () => void
} {
  const t: Tracking = { componentName, counts: new Map(), seen: new Map() }
  // Note what is on screen now without counting it: those fibers carry the flags of whatever
  // rendered them last.
  visit(latest, t)
  t.counts.clear()
  tracking = t
  return {
    read: () => new Map(t.counts),
    stop: () => { if (tracking === t) tracking = null },
  }
}
