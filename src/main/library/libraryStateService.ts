import { errorMessage } from '@shared/errors'
import { isRecord } from '@shared/guards'
import { parseLibraryState, type LibraryPatch, type LibrarySnapshot, type LibraryState } from '@shared/libraryState'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'

interface LibraryFile extends LibraryState {
  seeded: boolean
}

export interface LibraryStateDeps {
  /** `library-state.json` in userData. */
  file: string
  /** Values an older Apiary kept elsewhere (`hideToolCallIo` in settings.json), applied once at start. */
  moved: LibraryPatch
  /** Told every new snapshot; the container broadcasts it (`libraryStateChanged`). */
  onChanged: (snapshot: LibrarySnapshot) => void
}

/**
 * The sessions library's arrangement and reading preferences (`shared/libraryState.ts`), owned by
 * the main of the machine whose sessions they describe. A remote window's `libraryState` calls are
 * `remote`, so they land here on the work machine, and its `libraryStateChanged` reaches them
 * through `broadcast`'s remote targets like any other `remote` event.
 *
 * `seeded` exists for the one-time move out of localStorage: the first local window to find it
 * false sends what it had kept there, and once anything has been written (a seed or a set) a seed is
 * refused. A home machine that connects first therefore cannot fill a work machine's library with
 * home's pins — it is not a local window and never seeds — and neither can a second local window.
 */
export class LibraryStateService {
  private current: LibraryFile
  private readonly store: JsonStore<LibraryFile>

  constructor(private readonly deps: LibraryStateDeps) {
    this.store = new JsonStore<LibraryFile>({
      file: deps.file,
      version: 1,
      parse: (raw) => ({ ...parseLibraryState(raw), seeded: isRecord(raw) && raw.seeded === true }),
      fallback: () => ({ ...parseLibraryState({}), seeded: false }),
    })
    this.current = this.store.load()
    if (Object.keys(deps.moved).length > 0) {
      this.current = { ...this.current, ...deps.moved }
      this.save()
    }
  }

  snapshot(): LibrarySnapshot {
    const { seeded, ...state } = this.current
    return { state, seeded }
  }

  /** The contract's guard has already validated `patch`; persists it and tells every window. */
  set(patch: LibraryPatch): LibrarySnapshot {
    return this.apply(patch)
  }

  /** Applies a patch only while nothing has been written yet; answers the snapshot either way. */
  seed(patch: LibraryPatch): LibrarySnapshot {
    if (this.current.seeded) return this.snapshot()
    return this.apply(patch)
  }

  private apply(patch: LibraryPatch): LibrarySnapshot {
    this.current = { ...this.current, ...patch, seeded: true }
    this.save()
    const snapshot = this.snapshot()
    this.deps.onChanged(snapshot)
    return snapshot
  }

  /** A read-only home directory must not crash the app; the change still holds for this run. */
  private save(): void {
    try {
      this.store.save(this.current)
    } catch (e) {
      log.warn('library', 'could not write library state', { error: errorMessage(e) })
    }
  }
}
