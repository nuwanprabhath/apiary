import type { ProjectNode, SessionNode } from '@shared/types'
import type { TreeChange } from '@shared/domain/session'
import { flattenTree } from '@shared/treeWalk'
import { createIpcStore } from './createIpcStore'
import { onRemoteReconnected } from './remote'
import { shareTree } from './treeShare'

/**
 * The session tree, and the one place the renderer reads it or hears that it changed.
 * `onTreeChanged` fires roughly once a second while any Claude session is writing, so each reader
 * fetching for itself would cost several full-tree round trips per change.
 *
 * `window.apiary.onTreeChanged` is listened to once, and a signal
 *
 * 1. starts the store's own re-fetch (when something is rendering the tree — the sidebar), then
 * 2. calls everything registered with `onChanged`, synchronously and in order, in the same tick.
 *
 * Effects that only need to check against the tree call `current()`: it joins a fetch started
 * since the last signal and never reuses one that predates it, so one `treeChanged` costs one
 * `tree()` call and the tree an effect sees is at least as fresh as its signal. Joining is by
 * signal count, not listener order (JS does not order independently registered listeners).
 *
 * The last tree is kept for the life of the window, so `findSessionById` needs no round trip.
 */
/** Invalidated by: nothing; it only ever holds the newest fetched tree, which the next fetch shares nodes with. */
let lastFetched: ProjectNode[] = []

const UNKNOWN: TreeChange = { sessions: null }
/**
 * The change the store is invalidating for. Its listeners run synchronously inside `invalidate`,
 * so each reads the change it was called for. Invalidated by: the next change signal.
 */
let lastChange: TreeChange = UNKNOWN

const store = createIpcStore<ProjectNode[]>({
  scope: 'refresh',
  initial: [],
  fetch: async () => {
    // The last answer, not the store's snapshot: a test swapping `window.apiary` resets the store.
    const next = shareTree(lastFetched, await window.apiary.tree())
    lastFetched = next
    return next
  },
  // A reconnected remote window missed changes while it was away: ask again.
  subscribe: (_push, invalidate) => {
    const heard = (change: TreeChange): void => { lastChange = change; invalidate() }
    const off = [
      window.apiary.onTreeChanged((change) => { heard(change ?? UNKNOWN) }),
      onRemoteReconnected(() => { heard(UNKNOWN) }),
    ]
    return () => { for (const f of off) f() }
  },
})

/** `SessionNode`s by id, memoised per tree: rebuilt at most once per change. */
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
  /**
   * Runs `cb` on every `treeChanged`, after the store has started its own re-fetch, with what
   * changed (`sessions: null` when unknown, or after a remote reconnect).
   */
  onChanged: (cb: (change: TreeChange) => void): (() => void) => store.onInvalidate(() => { cb(lastChange) }),
  /** A session by id, at any depth, from the most recently fetched tree. */
  findSessionById: (id: string): SessionNode | null => byIdMap().get(id) ?? null,
  /** The full, unfiltered tree in a component; `[]` until the first answer. */
  useTree: (): ProjectNode[] => store.useStore(),
  /** False until the first answer. */
  useLoaded: store.useLoaded,
}
