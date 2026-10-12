import {
  libraryDefaults, pickLibraryPatch, type LibraryPatch, type LibrarySnapshot, type LibraryState,
} from '@shared/libraryState'
import { createIpcStore } from './createIpcStore'
import { background } from './policy'
import { onRemoteReconnected } from './remote'
import { legacyLibraryRecords } from './uiState'
import { remoteHost } from './windowParams'

/**
 * The sessions library's arrangement and reading preferences (`shared/libraryState.ts`): pins,
 * groups, folder order, Recent dismissals, each chat's settings, whether tool calls start hidden.
 *
 * Main owns it, on the machine whose sessions it describes, so this store is the same in every
 * window: in a remote window its calls are `remote` and reach the work machine, which is how home
 * shows the work machine's groups and tool-call choices. Main pushes every change to every window
 * (`libraryStateChanged`), which is also what keeps two local windows in step.
 *
 * Before 1.39 the sidebar half lived in this window's localStorage (`apiary.shared`) and the
 * per-chat half under `apiary.chatSettings`. The first local window to find main's state unseeded
 * sends those, once (`seedLibraryState`); main refuses a seed once anything is written. A remote
 * window never seeds: home's localStorage describes home's sessions, not the work machine's.
 */
const store = createIpcStore<LibrarySnapshot>({
  scope: 'library',
  initial: { state: libraryDefaults(), seeded: true },
  fetch: async () => {
    const snapshot = await window.apiary.libraryState()
    if (snapshot.seeded || remoteHost() !== null) return snapshot
    return window.apiary.seedLibraryState(legacySeed())
  },
  subscribe: (push, invalidate) => {
    const off = [window.apiary.onLibraryStateChanged(push), onRemoteReconnected(invalidate)]
    return () => { for (const f of off) f() }
  },
})

/** What an older Apiary kept in this machine's localStorage, as far as the registry recognises it. */
function legacySeed(): LibraryPatch {
  const { arrangement, chats } = legacyLibraryRecords()
  return { ...pickLibraryPatch(arrangement), ...pickLibraryPatch({ chatSettings: chats }) }
}

const stateOf = (snapshot: LibrarySnapshot): LibraryState => snapshot.state

/** The library state, in a component. Defaults until main's answer lands. */
export function useLibraryState(): LibraryState {
  return store.useStore(stateOf)
}

/** The library state as main last said, joining a read in flight (the Settings dialog's draft). */
export const readLibraryState = async (): Promise<LibraryState> => (await store.current()).state

/**
 * The change still being sent, answering the state main returned for it. A change asked for while
 * one is in flight builds on that answer, not on the last push: over a remote connection main
 * answers a round trip later, and a second pin made meanwhile, worked out from the state before the
 * first, sent a `pinned` without the first and unpinned it.
 */
let inFlight: Promise<LibraryState> | null = null

/** What the next change builds on: the change in flight's answer, else the latest push. */
function latest(): Promise<LibraryState> {
  if (inFlight !== null) return inFlight
  return store.isLoaded() ? Promise.resolve(store.getSnapshot().state) : store.current().then((s) => s.state)
}

/**
 * Changes the fields `change` returns, worked out from the latest state (see `inFlight`), one change
 * at a time. Policy 1: the screen follows main's push, so a failure leaves it showing what is really
 * stored, and is logged. A change asked for before the first answer waits for it, so it never builds
 * on the defaults.
 */
export function updateLibraryState(change: (state: LibraryState) => LibraryPatch): void {
  const sent = latest().then(async (state) => (await window.apiary.setLibraryState(change(state))).state)
  // A failed change must not block the next one: it builds on what main last said instead.
  const settled = sent.catch(async () => (await store.current()).state)
  inFlight = settled
  void settled.then(() => { if (inFlight === settled) inFlight = null })
  background(sent, 'library')
}

/** Saves fields the caller awaits (the Settings dialog's Save). Policy 3. */
export const saveLibraryState = (patch: LibraryPatch): Promise<LibrarySnapshot> => window.apiary.setLibraryState(patch)
