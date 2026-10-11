import type { ProjectNode, SessionNode } from '@shared/types'
import { flattenTree } from '@shared/treeWalk'
import { createIpcStore } from './createIpcStore'
import { onRemoteReconnected } from './remote'

/**
 * The session tree, and the one place the renderer reads it or hears that it changed (UI-3).
 *
 * Before this, three separate effects in `App.tsx` — the pending-session reconciler, the
 * terminal-follows-its-session rekey, and the open tabs' title/liveness refresh — each called
 * `window.apiary.tree()` for themselves on every `onTreeChanged` push, which fires roughly once a
 * second while any Claude session is writing: 3 full-tree IPC round trips, each walked again in
 * main, for one change; the sidebar's search cache made a 4th. And every hook that wanted to know
 * the tree had changed registered its own `onTreeChanged` listener.
 *
 * Now it is a `createIpcStore`: `window.apiary.onTreeChanged` is listened to once, and a signal
 *
 * 1. starts the store's own re-fetch (when something is rendering the tree — the sidebar), then
 * 2. calls everything registered with `onChanged`, synchronously and in order, in the same tick.
 *
 * The effects that only need to *check against* the tree call `current()`: it joins a fetch that
 * was started since the last signal (the sidebar's, or the first effect's), so one `treeChanged`
 * costs one `tree()` call, and it never reuses a fetch that predates the signal — so the tree an
 * effect sees is always at least as fresh as the signal that woke it. (An earlier version cached
 * "until something marks it stale" with a listener that had to run before the callers checking it;
 * JS does not order independently registered listeners, so it froze on the first tree it ever
 * loaded, and `sessionFollowing.spec.ts` caught it. Joining is by signal count, not by listener
 * order, which is what makes this safe.)
 *
 * It keeps the last tree for the life of the window (see `createIpcStore`'s note on lifetime), so
 * `findSessionById` can answer from the most recent fetch without a round trip.
 */
const store = createIpcStore<ProjectNode[]>({
  scope: 'refresh',
  initial: [],
  fetch: () => window.apiary.tree(),
  // A reconnected remote window missed changes while it was away: ask again.
  subscribe: (_push, invalidate) => {
    const off = [window.apiary.onTreeChanged(invalidate), onRemoteReconnected(invalidate)]
    return () => { for (const f of off) f() }
  },
})

/** `SessionNode`s by id, memoised per tree — rebuilt at most once per change no matter how many
 *  callers ask, instead of each walking the tree again for its own id. */
let byIdFor: ProjectNode[] | null = null
let byId = new Map<string, SessionNode>()

function byIdMap(): Map<string, SessionNode> {
  const tree = store.getSnapshot()
  if (byIdFor !== tree) {
    byId = flattenTree(tree)
    byIdFor = tree
  }
  return byId
}

export const treeStore = {
  /** Resolves with a fetch already in flight since the last change signal, or starts one. */
  current: store.current,
  /** Fire-and-forget refresh. */
  reload: store.reload,
  /** A fresh fetch, resolved with its answer. */
  reloadNow: store.refresh,
  /** Runs `cb` on every `treeChanged`, after the store has started its own re-fetch. */
  onChanged: store.onInvalidate,
  /** A session by id, at any depth, from the most recently fetched tree. */
  findSessionById: (id: string): SessionNode | null => byIdMap().get(id) ?? null,
  /** The full, unfiltered tree in a component; `[]` until the first answer. */
  useTree: (): ProjectNode[] => store.useStore(),
  /** False until the first answer. */
  useLoaded: store.useLoaded,
}
