/**
 * Library state in the fake, modelled on `LibraryStateService` (src/main/library): a set always
 * applies and marks the state seeded, a seed applies only while unseeded, and either one that
 * changes something tells every window with `libraryStateChanged`. The contract
 * (`tests/contract/clauses/libraryState.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { libraryDefaults, type LibraryPatch, type LibrarySnapshot } from '@shared/libraryState'
import type { Env } from './state'

type LibraryApi = Pick<ApiaryApi, 'libraryState' | 'setLibraryState' | 'seedLibraryState'>

export function initialLibrary(patch: LibraryPatch | undefined, seeded: boolean | undefined): LibrarySnapshot {
  return { state: { ...libraryDefaults(), ...patch }, seeded: seeded ?? patch !== undefined }
}

export function libraryApi(env: Env): LibraryApi {
  const { state, emit } = env
  const apply = (patch: LibraryPatch): LibrarySnapshot => {
    state.library = { state: { ...state.library.state, ...patch }, seeded: true }
    emit('libraryStateChanged', state.library)
    return state.library
  }
  return {
    libraryState: async () => state.library,
    setLibraryState: async (patch) => apply(patch),
    seedLibraryState: async (patch) => (state.library.seeded ? state.library : apply(patch)),
  }
}
