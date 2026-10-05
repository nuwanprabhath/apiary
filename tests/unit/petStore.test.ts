import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PetStore } from '../../src/main/pets/petStore'
import { STARTER_PET } from '@shared/pets/builtins'

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-pets-')); file = join(dir, 'pets.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('PetStore', () => {
  it('starts off with no pets when there is no file, or one it cannot read', () => {
    expect(new PetStore(file).enabled).toBe(false)
    writeFileSync(file, '{not json')
    const store = new PetStore(file)
    expect([store.enabled, store.list()]).toEqual([false, []])
  })

  it('keeps what it is given across a reload, validated', () => {
    const a = new PetStore(file)
    a.setEnabled(true)
    const pet = a.add(STARTER_PET, { model: 'sonnet' })
    a.update(pet.id, { size: 92, place: { region: 'rail', at: 0.4 } })
    const b = new PetStore(file)
    expect(b.enabled).toBe(true)
    expect(b.get(pet.id)).toMatchObject({ spec: STARTER_PET, model: 'sonnet', size: 92, active: true, place: { region: 'rail', at: 0.4 } })
    // Written whole, through a temporary file: nothing else is left in the folder.
    expect(readdirSync(dir)).toEqual(['pets.json'])
  })

  it('drops a pet it cannot read and keeps the rest', () => {
    writeFileSync(file, JSON.stringify({
      enabled: true,
      pets: [{ id: 'ok', spec: STARTER_PET }, { id: '', spec: STARTER_PET }, { id: 'bad', spec: 'nope' }, { id: 'ok', spec: STARTER_PET }],
    }))
    expect(new PetStore(file).list().map((p) => p.id)).toEqual(['ok'])
  })

  it('lets at most three pets out at once', () => {
    const store = new PetStore(file)
    const pets = [1, 2, 3, 4].map(() => store.add(STARTER_PET))
    expect(pets.map((p) => p.active)).toEqual([true, true, true, false])
    expect(() => store.update(pets[3].id, { active: true })).toThrow('Up to 3 pets')
    store.update(pets[0].id, { active: false })
    expect(store.update(pets[3].id, { active: true }).active).toBe(true)
  })

  it('keeps size and place within bounds, and renames through the validator', () => {
    const store = new PetStore(file)
    const pet = store.add(STARTER_PET)
    expect(store.update(pet.id, { size: 500 }).size).toBe(128)
    expect(store.update(pet.id, { size: 1 }).size).toBe(32)
    expect(store.update(pet.id, { place: { region: 'bar', at: 7 } }).place).toEqual({ region: 'bar', at: 1 })
    expect(store.update(pet.id, { name: `  ${'N'.repeat(40)}` }).spec.name).toHaveLength(24)
  })

  it('takes new lines only through the line cleaner, keeping situations it was not given', () => {
    const store = new PetStore(file)
    const pet = store.add(STARTER_PET)
    store.setLines(pet.id, { idle: ['fresh', 7, 'x'.repeat(300)], bogus: ['no'] }, 1234)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { pets: { spec: typeof STARTER_PET; voicedAt: number }[] }
    expect(saved.pets[0].spec.lines.idle).toEqual(['fresh', 'x'.repeat(80)])
    expect(saved.pets[0].spec.lines.working).toEqual(STARTER_PET.lines.working)
    expect(saved.pets[0].voicedAt).toBe(1234)
  })
})
