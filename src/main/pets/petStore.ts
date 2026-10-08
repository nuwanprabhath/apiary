import { randomUUID } from 'node:crypto'
import { validatePet, cleanLines } from '@shared/pets/validate'
import {
  MAX_ACTIVE_PETS, PET_MODELS, PET_SIZES, isPetPlace,
  type PetLines, type PetModel, type PetPatch, type PetPlace, type PetRecord,
} from '@shared/pets/state'
import { clamp, isFiniteNumber, isOneOf, isRecord } from '@shared/guards'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'

interface PetsFile { enabled: boolean; pets: PetRecord[] }

const clampSize = (n: unknown): number =>
  isFiniteNumber(n) ? Math.round(clamp(n, PET_SIZES.min, PET_SIZES.max)) : PET_SIZES.default
const clampPlace = (p: unknown): PetPlace | null =>
  isPetPlace(p) ? { region: p.region, at: clamp(p.at, 0, 1) } : null

/** Everything read back is re-validated; a pet that cannot be read is dropped and the rest kept. */
function parsePetsFile(raw: unknown): PetsFile {
  const r = isRecord(raw) ? raw : {}
  const pets: PetRecord[] = []
  for (const p of Array.isArray(r.pets) ? (r.pets as unknown[]) : []) {
    const o = isRecord(p) ? p : {}
    const spec = validatePet(o.spec)
    if (typeof o.id !== 'string' || o.id === '' || spec === null || pets.some((x) => x.id === o.id)) {
      log.warn('pets', 'dropped invalid pet')
      continue
    }
    pets.push({
      id: o.id,
      spec,
      model: isOneOf(PET_MODELS, o.model) ? o.model : 'haiku',
      size: clampSize(o.size),
      active: o.active === true && pets.filter((x) => x.active).length < MAX_ACTIVE_PETS,
      place: clampPlace(o.place),
      createdAt: isFiniteNumber(o.createdAt) ? o.createdAt : 0,
      voicedAt: isFiniteNumber(o.voicedAt) ? o.voicedAt : 0,
    })
  }
  return { enabled: r.enabled === true, pets }
}

/**
 * `pets.json`: whether pets are on, and every installed pet with where it stands.
 *
 * Its own file, like `themes.json`, rather than a field in settings.json — a default written into
 * settings.json can never be changed for anyone (main/CLAUDE.md). Everything read back is validated
 * again, so a pet on disk can never reach the window without passing `validatePet`; a pet that
 * cannot be read is dropped and the rest kept. Reads and writes go through `JsonStore`.
 */
export class PetStore {
  private data: PetsFile
  private readonly store: JsonStore<PetsFile>

  constructor(file: string) {
    this.store = new JsonStore<PetsFile>({
      file,
      version: 1,
      parse: parsePetsFile,
      fallback: (reason) => {
        if (reason === 'unreadable') log.warn('pets', 'pets file unreadable, starting empty')
        return { enabled: false, pets: [] }
      },
    })
    this.data = this.store.load()
  }

  private save(): void {
    this.store.save(this.data)
  }

  get enabled(): boolean { return this.data.enabled }

  setEnabled(on: boolean): void {
    this.data.enabled = on
    this.save()
  }

  list(): PetRecord[] { return this.data.pets }

  get(id: string): PetRecord | undefined { return this.data.pets.find((p) => p.id === id) }

  private must(id: string): PetRecord {
    const pet = this.get(id)
    if (pet === undefined) throw new Error('No such pet.')
    return pet
  }

  private activeCount(): number { return this.data.pets.filter((p) => p.active).length }

  /** Adds a pet, validated; it comes out only if there is room for one more. */
  add(spec: unknown, opts: { model?: PetModel; active?: boolean } = {}): PetRecord {
    const valid = validatePet(spec)
    if (valid === null) throw new Error('That is not a pet.')
    const pet: PetRecord = {
      id: randomUUID(),
      spec: valid,
      model: isOneOf(PET_MODELS, opts.model) ? opts.model : 'haiku',
      size: PET_SIZES.default,
      active: (opts.active ?? true) && this.activeCount() < MAX_ACTIVE_PETS,
      place: null,
      createdAt: Date.now(),
      voicedAt: 0,
    }
    this.data.pets.push(pet)
    this.save()
    return pet
  }

  update(id: string, patch: PetPatch): PetRecord {
    const pet = this.must(id)
    if (patch.active === true && !pet.active && this.activeCount() >= MAX_ACTIVE_PETS) {
      throw new Error(`Up to ${String(MAX_ACTIVE_PETS)} pets can be out at once.`)
    }
    if (typeof patch.active === 'boolean') pet.active = patch.active
    if (isOneOf(PET_MODELS, patch.model)) pet.model = patch.model
    if (patch.size !== undefined) pet.size = clampSize(patch.size)
    if (patch.place !== undefined) pet.place = clampPlace(patch.place)
    if (typeof patch.name === 'string') {
      const renamed = validatePet({ ...pet.spec, name: patch.name })
      if (renamed !== null) pet.spec = renamed
    }
    this.save()
    return pet
  }

  remove(id: string): void {
    this.must(id)
    this.data.pets = this.data.pets.filter((p) => p.id !== id)
    this.save()
  }

  /** New lines from the pet's model replace the old ones for the situations they cover. */
  setLines(id: string, lines: unknown, at: number): PetLines {
    const pet = this.must(id)
    const clean = cleanLines(lines)
    pet.spec = { ...pet.spec, lines: { ...pet.spec.lines, ...clean } }
    pet.voicedAt = at
    this.save()
    return clean
  }
}
