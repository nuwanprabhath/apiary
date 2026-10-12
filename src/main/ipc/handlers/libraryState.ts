import type { LibraryStateService } from '../../library/libraryStateService'
import type { Handlers } from '../registrar'

type HandledKeys = 'libraryState' | 'setLibraryState' | 'seedLibraryState'

/**
 * The contract's guard (`isLibraryPatch`) has already refused unknown keys and wrong types; the
 * service persists and broadcasts `libraryStateChanged`.
 */
export function libraryStateHandlers(library: LibraryStateService): Pick<Handlers, HandledKeys> {
  return {
    libraryState: () => library.snapshot(),
    setLibraryState: (_e, patch) => library.set(patch),
    seedLibraryState: (_e, patch) => library.seed(patch),
  }
}
