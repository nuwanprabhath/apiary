import type { ThemeModel } from '../theme/models'
import type { PetSpec, Situation } from './spec'

export { THEME_MODELS as PET_MODELS } from '../theme/models'

/** Extra large is about the height of the composer's hint line to its top edge — as asked, 1.31.0. */
export const PET_SIZES = { min: 32, max: 128, default: 64 } as const
/** The sizes the right-click menu offers. */
export const PET_SIZE_STEPS = [{ label: 'Small', size: 44 }, { label: 'Medium', size: 64 }, { label: 'Large', size: 92 }, { label: 'Extra large', size: 128 }] as const
export const MAX_ACTIVE_PETS = 3

export type PetModel = ThemeModel

/** Where a pet stands: along the rail (0 = bottom, 1 = top) or the bar (0 = left, 1 = right). */
export interface PetPlace { region: 'rail' | 'bar'; at: number }

export interface PetRecord {
  id: string
  spec: PetSpec
  model: PetModel
  size: number
  /** Out in the window (at most `MAX_ACTIVE_PETS`), rather than only installed. */
  active: boolean
  place: PetPlace | null
  /** The number of the window it is out in (`WindowManager`'s, the one its layout is restored
   *  with); only that window draws it. Null while it has none: put away, or from before 1.41. */
  window: number | null
  createdAt: number
  /** When its lines were last written by its model; 0 for never. */
  voicedAt: number
}

export interface PetsState {
  enabled: boolean
  pets: PetRecord[]
  /** A pet is being designed (Settings shows it, and the first enable waits on it). */
  generating: boolean
  /** The pet last dropped into a window from another, with the release point in that window's own
   *  coordinates, so it lands at the nearest spot there. Not persisted; `seq` tells drops apart. */
  arrival: PetArrival | null
}

export interface PetArrival { id: string; window: number; x: number; y: number; seq: number }

export interface PetPatch {
  name?: string
  model?: PetModel
  size?: number
  active?: boolean
  place?: PetPlace | null
}

/** What an exported pet file holds: the pet itself, nothing about where it lived. */
export interface PetExportFile { apiaryPet: 1; spec: PetSpec }

export type PetLines = Partial<Record<Situation, string[]>>

export function isPetPlace(v: unknown): v is PetPlace {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (p.region === 'rail' || p.region === 'bar') && typeof p.at === 'number' && Number.isFinite(p.at)
}
