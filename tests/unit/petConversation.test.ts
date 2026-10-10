import { describe, it, expect } from 'vitest'
import { Brain, type BrainPet } from '@shared/pets/brain'
import { STARTER_PET } from '@shared/pets/builtins'
import type { PetSpec } from '@shared/pets/spec'
import { validatePet } from '@shared/pets/validate'

const pet = (id: string, over: Partial<BrainPet['traits']> = {}, at = 0.5): BrainPet => ({
  id,
  traits: { ...STARTER_PET.traits, ...over },
  lines: STARTER_PET.lines,
  place: { region: 'bar', at },
  size: 28,
})

function brain(pets: BrainPet[], opts: { rail?: number; seed?: number } = {}): Brain {
  const b = new Brain(opts.seed ?? 7)
  b.handle({ kind: 'habitat', rail: opts.rail ?? 600, bar: 800 })
  b.handle({ kind: 'pets', pets })
  return b
}

function run(b: Brain, ms: number) {
  const cmds = []
  for (let t = 0; t < ms; t += 250) cmds.push(...b.tick(250))
  return cmds
}

describe('pet conversations', () => {
  it('sociable pets visit each other and greet', () => {
    const cmds = run(brain([pet('a', { sociability: 1 }, 0.1), pet('b', { sociability: 1 }, 0.9)], { seed: 5, rail: 0 }), 60 * 60_000)
    const greet = STARTER_PET.lines.greet ?? []
    const greetings = cmds.filter((c) => c.say !== undefined && greet.includes(c.say.text))
    expect(greetings.length).toBeGreaterThan(0)
  })

  it('when two pets greet, both speak in an exchange', () => {
    const b = brain([pet('a', { sociability: 1 }, 0.2), pet('b', { sociability: 1 }, 0.8)], { seed: 42, rail: 0 })
    const cmds = run(b, 60 * 60_000)

    const greet = STARTER_PET.lines.greet ?? []
    const greetsByPet = new Map<string, number>()
    for (const cmd of cmds) {
      if (cmd.say !== undefined && greet.includes(cmd.say.text)) {
        greetsByPet.set(cmd.id, (greetsByPet.get(cmd.id) ?? 0) + 1)
      }
    }

    expect(greetsByPet.size).toBeGreaterThanOrEqual(2)
  })

  it('pets participate in multiple conversations over time', () => {
    const b = brain([pet('a', { sociability: 1 }, 0.2), pet('b', { sociability: 1 }, 0.8)], { seed: 99, rail: 0 })
    const cmds = run(b, 60 * 60_000)

    const greet = STARTER_PET.lines.greet ?? []
    const conversation = STARTER_PET.lines.conversation ?? []
    const wrapped = STARTER_PET.lines.wrappedUp ?? []

    let conversationLines = 0
    for (const cmd of cmds) {
      if (cmd.say === undefined) continue
      const isRelevant = greet.includes(cmd.say.text) || conversation.includes(cmd.say.text) || wrapped.includes(cmd.say.text)
      if (isRelevant) conversationLines++
    }

    // Over 60 minutes, we should see multiple rounds of greetings
    expect(conversationLines).toBeGreaterThan(10)
  })

  it('conversations end with wrap-up lines', () => {
    const b = brain([pet('a', { sociability: 1 }, 0.2), pet('b', { sociability: 1 }, 0.8)], { seed: 77, rail: 0 })
    const cmds = run(b, 60 * 60_000)

    const greet = STARTER_PET.lines.greet ?? []
    const wrapped = STARTER_PET.lines.wrappedUp ?? []

    const hasGreet = cmds.some((c) => c.say !== undefined && greet.includes(c.say.text))
    const hasWrapped = cmds.some((c) => c.say !== undefined && wrapped.includes(c.say.text))

    expect(!hasGreet || hasWrapped).toBe(true)
  })

  it('old pets without conversation lines still load and validate', () => {
    const oldPet: PetSpec = {
      version: 1,
      name: 'Legacy',
      tagline: 'An old pet',
      body: { shape: 'blob', color: '#2f7bff', accent: '#6fb1ff', texture: 'fuzzy' },
      eyes: { style: 'round', color: '#10121c' },
      cheeks: true,
      arms: 'nub',
      legs: 'stubby',
      accessories: [],
      traits: { energy: 0.5, curiosity: 0.5, sleepiness: 0.5, sociability: 0.5 },
      lines: {
        idle: ['Hello'],
        greet: ['Hi friend!'],
      },
    }

    const validated = validatePet(oldPet)
    expect(validated).toBeDefined()
    expect(validated?.name).toBe('Legacy')
    expect(validated?.lines.greet).toBeDefined()
  })
})
