import { describe, it, expect } from 'vitest'
import { validatePet, cleanLine } from '@shared/pets/validate'
import { STARTER_PET } from '@shared/pets/builtins'
import { LIMITS } from '@shared/pets/spec'

/**
 * The validator is the pets feature's security boundary: whatever Claude replies, or whatever an
 * imported file holds, only what passes here is drawn. So these tests are mostly about input
 * nobody should send.
 */
describe('validatePet', () => {
  it('turns something that is not an object into nothing, and an empty object into a default pet', () => {
    expect(validatePet(null)).toBeNull()
    expect(validatePet('pet')).toBeNull()
    expect(validatePet([1])).toBeNull()
    const pet = validatePet({})!
    expect(pet.name).toBe('Pet')
    expect(pet.body.shape).toBe('blob')
    expect(pet.traits).toEqual({ energy: 0.5, curiosity: 0.5, sleepiness: 0.5, sociability: 0.5 })
  })

  it('keeps the starter pet exactly as it is, and validating twice changes nothing', () => {
    expect(validatePet(STARTER_PET)).toEqual(STARTER_PET)
    const once = validatePet({ name: '  Zed  ', body: { color: '#ABC' } })!
    expect(validatePet(once)).toEqual(once)
  })

  it('accepts only plain hex colours, re-serialised; anything else falls back', () => {
    const pet = validatePet({
      body: { color: '#ABC', accent: 'url(https://example.com/x.png)' },
      eyes: { color: 'red; display:none' },
      accessories: [{ kind: 'cap', color: '" onload="alert(1)' }],
    })!
    expect(pet.body.color).toBe('#aabbcc')
    expect(pet.body.accent).toBe('#aabbcc')
    expect(pet.eyes.color).toBe('#14141f')
    expect(pet.accessories[0].color).toBe('#1f1f2e')
  })

  it('falls back from unknown parts, and wears at most one accessory per slot and three in all', () => {
    const pet = validatePet({
      body: { shape: 'dragon', texture: 'scales' },
      eyes: { style: 'laser' },
      arms: 'tentacle', legs: 'wheels',
      accessories: [
        { kind: 'beret' }, { kind: 'crown' }, { kind: 'jetpack' }, { kind: 'sunglasses' },
        { kind: 'scarf' }, { kind: 'bowtie' },
      ],
    })!
    expect([pet.body.shape, pet.body.texture, pet.eyes.style, pet.arms, pet.legs]).toEqual(['blob', 'fuzzy', 'round', 'nub', 'stubby'])
    expect(pet.accessories.map((a) => a.kind)).toEqual(['beret', 'sunglasses', 'scarf'])
  })

  it('clamps traits to 0..1 and treats a non-number as the middle', () => {
    const pet = validatePet({ traits: { energy: 7, curiosity: -2, sleepiness: Number.NaN, sociability: '1' } })!
    expect(pet.traits).toEqual({ energy: 1, curiosity: 0, sleepiness: 0.5, sociability: 0.5 })
  })

  it('caps text and strips control characters; markup stays text', () => {
    const pet = validatePet({
      name: 'A'.repeat(100),
      tagline: 'line one\nline two\u0007',
      lines: {
        idle: ['<script>alert(1)</script>', 42, '', 'x'.repeat(200), ...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`)],
        nonsense: ['ignored'],
      },
    })!
    expect(pet.name).toHaveLength(LIMITS.name)
    expect(pet.tagline).toBe('line one line two')
    expect(pet.lines.idle![0]).toBe('<script>alert(1)</script>')
    expect(pet.lines.idle![1]).toHaveLength(LIMITS.line)
    expect(pet.lines.idle).toHaveLength(LIMITS.linesPerSituation)
    expect(Object.keys(pet.lines)).toEqual(['idle'])
  })

  it('never reads inherited or prototype keys', () => {
    const raw = JSON.parse('{"__proto__": {"name": "Polluted"}, "body": {"__proto__": {"shape": "star"}}}') as unknown
    const pet = validatePet(raw)!
    expect(pet.name).toBe('Pet')
    expect(pet.body.shape).toBe('blob')
    expect(({} as Record<string, unknown>).name).toBeUndefined()
  })
})

describe('cleanLine', () => {
  it('returns null for nothing left, and one short plain line otherwise', () => {
    expect(cleanLine('   ')).toBeNull()
    expect(cleanLine(5)).toBeNull()
    expect(cleanLine('  hi\nthere  ')).toBe('hi there')
  })
})
