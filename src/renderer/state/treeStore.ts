import type { ProjectNode, SessionNode } from '@shared/types'

/**
 * A shared, de-duplicated way to ask for the current session tree (UI-3).
 *
 * Before this, three separate effects in `App.tsx` — the pending-session reconciler, the
 * terminal-follows-its-session rekey, and the open tabs' title/liveness refresh — each called
 * `window.apiary.tree()` for themselves on every `onTreeChanged` push, which fires roughly once a
 * second while any Claude session is writing. That is 3 full-tree IPC round trips, each walked
 * again in main, for one change (`useSessionTreeCache`, Sidebar's own copy for search and
 * filtering, makes a 4th; it is left as it is — see below).
 *
 * `current()` is what those effects call instead of `window.apiary.tree()` directly. All of them
 * fire from the *same* `onTreeChanged` event, so they run synchronously, one after another, in the
 * same tick — the first one to call `current()` starts the one real fetch (`inFlight`), and every
 * other caller in that same tick gets the same in-flight promise back instead of starting its own.
 *
 * `current()` deliberately does NOT cache across ticks (an earlier version tried "reuse the last
 * fetch until something marks it stale," keyed off a listener that reset the flag on the next
 * `onTreeChanged" — but "the next `onTreeChanged`" only reset it if that listener happened to run
 * *before* the callers checking it, and JS doesn't guarantee that ordering across independently
 * registered listeners. It measurably broke rekeying: the tree looked permanently frozen at
 * whatever it was on the first load, and `sessionFollowing.spec.ts` caught it — a real Claude
 * session updating its own tree state and the app never noticing.). A fetch here is only ever
 * shared with calls that are synchronously concurrent with it, never with calls from an earlier
 * tick, so the tree App's effects see is always at least as fresh as the `onTreeChanged` that woke
 * them.
 *
 * `useSessionTreeCache` (Sidebar's search/filter path) is deliberately NOT rebuilt on top of this
 * store. Routing it through the same shared cache would mean giving it a `useSyncExternalStore`
 * subscription — and that subscription, to behave correctly across `tests/component`'s convention
 * of swapping `window.apiary` for a brand new fake on every `renderApp()`, has to reset the shared
 * snapshot as a side effect of `subscribe`/`getSnapshot`, which is exactly the kind of externally
 * visible mutation `useSyncExternalStore` assumes those functions do not have — trying it measurably
 * broke an unrelated test (`update.test.tsx`) the one time it was attempted, for reasons that
 * pointed at that mismatch rather than at anything specific to trees. Left as an independent hook,
 * plus this separate cache for the effects that only need to *check against* the tree rather than
 * render it, still gets most of the win (App's own redundant fetches collapse to 1) with none of
 * that risk.
 */

let tree: ProjectNode[] = []
let inFlight: Promise<ProjectNode[]> | null = null
let version = 0

/** `SessionNode`s by id, memoised per fetch — rebuilt at most once per tree change no matter how
 *  many callers ask, instead of each walking the tree again for its own id. */
let byIdCache: Map<string, SessionNode> | null = null
let byIdCacheVersion = -1

/** The `window.apiary` the cache was last fetched from. */
let boundApiary: typeof window.apiary | null = null

/**
 * Starts over when `window.apiary` is not the one the cache holds data from — the case that
 * matters is a component test's `renderApp()`, which assigns a brand new fake with no relation to
 * whatever the previous test left behind. Cheap the rest of the time: one reference comparison.
 */
function ensureBound(): void {
  if (window.apiary === boundApiary) return
  boundApiary = window.apiary
  tree = []
  inFlight = null
}

function flatten(nodes: ProjectNode[], into: Map<string, SessionNode>): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flatten(node.children, into)
  }
  return into
}

function byIdMap(): Map<string, SessionNode> {
  ensureBound()
  if (byIdCache === null || byIdCacheVersion !== version) {
    byIdCache = flatten(tree, new Map())
    byIdCacheVersion = version
  }
  return byIdCache
}

async function fetchNow(): Promise<ProjectNode[]> {
  ensureBound()
  const request = window.apiary.tree()
  inFlight = request
  const next = await request
  // Superseded by a newer request started while this one was in flight (or by a reset from
  // `ensureBound`, which nulls `inFlight` too) — that one's result is what callers should see, not
  // this stale one landing late.
  if (inFlight === request) {
    tree = next
    inFlight = null
    version += 1
  }
  return next
}

/** Fire-and-forget refresh. */
function reload(): void { void fetchNow() }

/**
 * Resolves with whatever fetch is already in flight, or starts a fresh one. Never reuses a
 * finished fetch from an earlier tick — see the module doc for why that matters.
 */
function current(): Promise<ProjectNode[]> {
  ensureBound()
  return inFlight ?? fetchNow()
}

export const treeStore = {
  current,
  reload,
  reloadNow: fetchNow,
  /** A session by id, at any depth, from the most recently fetched tree. */
  findSessionById: (id: string): SessionNode | null => byIdMap().get(id) ?? null,
}
