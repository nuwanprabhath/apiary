import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validatePet, cleanLines } from '@shared/pets/validate'
import {
  MAX_ACTIVE_PETS, PET_MODELS, PET_SIZES, isPetPlace,
  type PetLines, type PetModel, type PetPatch, type PetPlace, type PetRecord,
} from '@shared/pets/state'
import { log } from '../log/logger'

interface PetsFile { version: 1; enabled: boolean; pets: PetRecord[] }

const isModel = (m: unknown): m is PetModel => typeof m === 'string' && (PET_MODELS as readonly string[]).includes(m)
const clampSize = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(PET_SIZES.max, Math.max(PET_SIZES.min, n))) : PET_SIZES.default
const clampPlace = (p: unknown): PetPlace | null =>
  isPetPlace(p) ? { region: p.region, at: Math.min(1, Math.max(0, p.at)) } : null

/**
 * `pets.json`: whether pets are on, and every installed pet with where it stands.
 *
 * Its own file, like `themes.json`, rather than a field in settings.json — a default written into
 * settings.json can never be changed for anyone (main/CLAUDE.md). Everything read back is validated
 * again, so a pet on disk can never reach the window without passing `validatePet`; a pet that
 * cannot be read is dropped and the rest kept. Writes go to a temp file renamed into place.
 */
export class PetStore {
  private data: PetsFile

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  private load(): PetsFile {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('pets', 'pets file unreadable, starting empty')
      return { version: 1, enabled: false, pets: [] }
    }
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const pets: PetRecord[] = []
    for (const p of Array.isArray(r.pets) ? (r.pets as unknown[]) : []) {
      const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
      const spec = validatePet(o.spec)
      if (typeof o.id !== 'string' || o.id === '' || spec === null || pets.some((x) => x.id === o.id)) {
        log.warn('pets', 'dropped invalid pet')
        continue
      }
      pets.push({
        id: o.id,
        spec,
        model: isModel(o.model) ? o.model : 'haiku',
        size: clampSize(o.size),
        active: o.active === true && pets.filter((x) => x.active).length < MAX_ACTIVE_PETS,
        place: clampPlace(o.place),
        createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0,
        voicedAt: typeof o.voicedAt === 'number' && Number.isFinite(o.voicedAt) ? o.voicedAt : 0,
      })
    }
    return { version: 1, enabled: r.enabled === true, pets }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${String(process.pid)}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
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
      model: isModel(opts.model) ? opts.model : 'haiku',
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
    if (isModel(patch.model)) pet.model = patch.model
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
