/**
 * Pets in the fake, modelled on main's `PetStore` and `PetService`: ids are minted here, a size and a
 * place are clamped, at most three pets are out, the first time pets are switched on one is
 * hatched, and a voice refresh happens at most once an hour. What only Claude can decide (the
 * design, the reply) is canned. The contract (`tests/contract/clauses/pets.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { clamp, isFiniteNumber, isOneOf } from '@shared/guards'
import { STARTER_PET } from '@shared/pets/builtins'
import { cleanLine, validatePet } from '@shared/pets/validate'
import { isPetPlace, MAX_ACTIVE_PETS, PET_MODELS, PET_SIZES, type PetPlace, type PetRecord, type PetsState } from '@shared/pets/state'
import type { Env } from './state'

/** A pet as main would store it: the starter pet, out, with no place yet. */
export function fakePet(id: string, over: Partial<PetRecord> = {}): PetRecord {
  return { id, spec: STARTER_PET, model: 'haiku', size: PET_SIZES.default, active: true, place: null, createdAt: 0, voicedAt: 0, ...over }
}

type PetsApi = Pick<ApiaryApi,
  | 'petsState' | 'petsSetEnabled' | 'petGenerate' | 'petGenerateCancel' | 'petUpdate' | 'petDelete' | 'petExport' | 'petImport'
  | 'petChat' | 'petVoice' | 'petClaudeActions' | 'petComment'>

const VOICE_INTERVAL_MS = 60 * 60 * 1000
const clampSize = (n: number): number => Math.round(clamp(n, PET_SIZES.min, PET_SIZES.max))
const clampPlace = (p: PetPlace): PetPlace => ({ region: p.region, at: clamp(p.at, 0, 1) })

export function petsApi(env: Env): PetsApi {
  const { state, emit } = env
  let minted = 0
  const set = (next: PetsState): void => { state.pets = next; emit('petsChanged', next) }
  const must = (id: string): PetRecord => {
    const pet = state.pets.pets.find((p) => p.id === id)
    if (pet === undefined) throw new Error('No such pet.')
    return pet
  }
  const activeCount = (): number => state.pets.pets.filter((p) => p.active).length
  /** Adds a pet, out if there is room for one more. */
  const add = (spec: PetRecord['spec'], model: PetRecord['model']): PetRecord => {
    minted += 1
    const pet = fakePet(`pet-${String(minted)}`, { spec, model, active: activeCount() < MAX_ACTIVE_PETS, createdAt: Date.now() })
    set({ ...state.pets, pets: [...state.pets.pets, pet] })
    return pet
  }
  const replace = (pet: PetRecord): void => { set({ ...state.pets, pets: state.pets.pets.map((p) => (p.id === pet.id ? pet : p)) }) }
  const voiced = new Map<string, number>()

  return {
    petsState: async () => state.pets,
    petsSetEnabled: async (enabled) => {
      set({ ...state.pets, enabled })
      if (enabled && state.pets.pets.length === 0) add(STARTER_PET, 'haiku')
    },
    petGenerate: async (description, model) => {
      const spec = description === null ? STARTER_PET : { ...STARTER_PET, tagline: description }
      return add(spec, isOneOf(PET_MODELS, model) ? model : 'haiku')
    },
    petGenerateCancel: () => {},
    petUpdate: async (id, patch) => {
      const pet = must(id)
      if (patch.active === true && !pet.active && activeCount() >= MAX_ACTIVE_PETS) {
        throw new Error(`Up to ${String(MAX_ACTIVE_PETS)} pets can be out at once.`)
      }
      const renamed = patch.name === undefined ? null : validatePet({ ...pet.spec, name: patch.name })
      const next: PetRecord = {
        ...pet,
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.size !== undefined ? { size: isFiniteNumber(patch.size) ? clampSize(patch.size) : PET_SIZES.default } : {}),
        ...(patch.place !== undefined ? { place: patch.place !== null && isPetPlace(patch.place) ? clampPlace(patch.place) : null } : {}),
        ...(renamed !== null ? { spec: renamed } : {}),
      }
      replace(next)
      return next
    },
    petDelete: async (id) => {
      must(id)
      voiced.delete(id)
      set({ ...state.pets, pets: state.pets.pets.filter((p) => p.id !== id) })
    },
    // The "file" the user picked: the pet last exported is what the next import reads.
    petExport: async (id) => { state.petFile = must(id).spec; return true },
    petImport: async () => {
      const spec = state.petFile === null ? null : validatePet(state.petFile)
      return spec === null ? null : add(spec, 'haiku')
    },
    petChat: async (id, text) => {
      must(id)
      if (text.trim() === '') throw new Error('Say something first.')
      return state.petReply
    },
    petVoice: async (id) => {
      const pet = state.pets.pets.find((p) => p.id === id)
      if (!state.pets.enabled || pet === undefined || !pet.active) return false
      const last = Math.max(pet.voicedAt, voiced.get(id) ?? 0)
      if (Date.now() - last < VOICE_INTERVAL_MS) return false
      voiced.set(id, Date.now())
      replace({ ...pet, voicedAt: Date.now() })
      return true
    },
    petClaudeActions: async (keys) => (!state.pets.enabled ? [] : keys.flatMap((key) => {
      const action = state.petActions[key]
      return action !== undefined ? [{ key, action }] : []
    })),
    petComment: async (id, action) => {
      const pet = state.pets.pets.find((p) => p.id === id)
      return !state.pets.enabled || pet === undefined || !pet.active || cleanLine(action) === null ? null : state.petComment
    },
  }
}
