import { clamp, isFiniteNumber, isOneOf, isRecord } from '../guards'
import type { VoiceContext } from './prompt'
import { isPetPlace, PET_MODELS, type PetPatch } from './state'

/**
 * What the renderer may send for the two pet calls that carry an object (`petUpdate`,
 * `petVoice`), as guards the contract can hold (`shared/ipc/contract.ts`) so the handler receives
 * a value that is already the declared type — no cast, no hand-cleaning in `handlers/pets.ts`.
 * Like `validatePet`, they sit on a trust boundary: a field of the wrong kind rejects the call;
 * a field that is merely out of range is limited by `limitVoiceContext` / the store.
 */

/** A patch to a pet: any subset of its editable fields, each of the right kind. Fields it does
 *  not know are ignored (`pickPetPatch` drops them), as before. */
export function isPetPatch(v: unknown): v is PetPatch {
  if (!isRecord(v)) return false
  return (v.name === undefined || typeof v.name === 'string')
    && (v.model === undefined || isOneOf(PET_MODELS, v.model))
    && (v.size === undefined || isFiniteNumber(v.size))
    && (v.active === undefined || typeof v.active === 'boolean')
    && (v.place === undefined || v.place === null || isPetPlace(v.place))
}

/** The patch as the store applies it: only the fields it knows, so nothing else a renderer
 *  attached rides along. */
export function pickPetPatch(patch: PetPatch): PetPatch {
  const out: PetPatch = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.model !== undefined) out.model = patch.model
  if (patch.size !== undefined) out.size = patch.size
  if (patch.active !== undefined) out.active = patch.active
  if (patch.place !== undefined) out.place = patch.place
  return out
}

/** What a pet's voice is asked about: counts, a few session titles and the local hour. */
export function isVoiceContext(v: unknown): v is VoiceContext {
  if (!isRecord(v)) return false
  return isFiniteNumber(v.working) && isFiniteNumber(v.waiting) && isFiniteNumber(v.finished)
    && isFiniteNumber(v.hour)
    && Array.isArray(v.titles) && v.titles.every((t) => typeof t === 'string')
}

const count = (n: number): number => clamp(Math.round(n), 0, 99)

/** The context as the model is told it: counts to 0–99, the hour to 0–23, at most 8 titles. */
export function limitVoiceContext(ctx: VoiceContext): VoiceContext {
  return {
    working: count(ctx.working),
    waiting: count(ctx.waiting),
    finished: count(ctx.finished),
    titles: ctx.titles.slice(0, 8),
    hour: clamp(Math.floor(ctx.hour), 0, 23),
  }
}
