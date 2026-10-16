import {
  libraryDefaults, pickLibraryPatch, type LibraryPatch, type LibrarySnapshot, type LibraryState,
} from '@shared/libraryState'
import { createIpcStore } from './createIpcStore'
import { background } from './policy'
import { onRemoteReconnected } from './remote'
import { legacyLibraryRecords } from './uiState'
import { remoteHost } from './windowParams'

/**
 * The sessions library's arrangement and reading preferences (`shared/libraryState.ts`). Main owns
 * it on the machine whose sessions it describes; in a remote window its calls reach the work
 * machine. Main pushes every change to every window.
 *
 * The first local window to find main's state unseeded sends the old localStorage records once
 * (`seedLibraryState`); main refuses a seed once anything is written. A remote window never seeds:
 * home's localStorage describes home's sessions, not the work machine's.
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

function legacySeed(): LibraryPatch {
  const { arrangement, chats } = legacyLibraryRecords()
  return { ...pickLibraryPatch(arrangement), ...pickLibraryPatch({ chatSettings: chats }) }
}

const stateOf = (snapshot: LibrarySnapshot): LibraryState => snapshot.state

/** Defaults until main's answer lands. */
export function useLibraryState(): LibraryState {
  return store.useStore(stateOf)
}

/** The library state as main last said, joining a read in flight (the Settings dialog's draft). */
export const readLibraryState = async (): Promise<LibraryState> => (await store.current()).state

/**
 * The change still being sent. A change asked for meanwhile builds on its answer, not the last
 * push: over a remote connection a second pin worked out from the state before the first sent a
 * `pinned` without the first and unpinned it.
 */
let inFlight: Promise<LibraryState> | null = null

/** What the next change builds on: the change in flight's answer, else the latest push. */
function latest(): Promise<LibraryState> {
  if (inFlight !== null) return inFlight
  return store.isLoaded() ? Promise.resolve(store.getSnapshot().state) : store.current().then((s) => s.state)
}

/**
 * Policy 1: the screen follows main's push, so a failure leaves it showing what is stored, and is
 * logged. A change asked for before the first answer waits for it, so it never builds on defaults.
 */
export function updateLibraryState(change: (state: LibraryState) => LibraryPatch): void {
  const sent = latest().then(async (state) => (await window.apiary.setLibraryState(change(state))).state)
  // A failed change must not block the next one: it builds on what main last said instead.
  const settled = sent.catch(async () => (await store.current()).state)
  inFlight = settled
  void settled.then(() => { if (inFlight === settled) inFlight = null })
  background(sent, 'library')
}

/** Policy 3: the Settings dialog's Save awaits it. */
export const saveLibraryState = (patch: LibraryPatch): Promise<LibrarySnapshot> => window.apiary.setLibraryState(patch)
