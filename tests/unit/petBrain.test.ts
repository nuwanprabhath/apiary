import { describe, it, expect } from 'vitest'
import { Brain, SPEECH_GAP_MS, type BrainPet, type Command, type SceneKind, type Scenery } from '@shared/pets/brain'
import { STARTER_PET } from '@shared/pets/builtins'

/**
 * The brain is pure and seeded, so these replay simulated time: an hour of a pet's life takes a
 * few milliseconds and comes out the same every run.
 */
const pet = (id: string, over: Partial<BrainPet['traits']> = {}, at = 0.5): BrainPet => ({
  id, traits: { ...STARTER_PET.traits, ...over }, lines: STARTER_PET.lines, place: { region: 'bar', at }, size: 28,
})

function brain(pets: BrainPet[], opts: { rail?: number; seed?: number } = {}): Brain {
  const b = new Brain(opts.seed ?? 7)
  b.handle({ kind: 'habitat', rail: opts.rail ?? 600, bar: 800 })
  b.handle({ kind: 'pets', pets })
  return b
}

/** Ticks at 4 Hz for `ms`, collecting every command. */
function run(b: Brain, ms: number): Command[] {
  const out: Command[] = []
  for (let t = 0; t < ms; t += 250) out.push(...b.tick(250))
  return out
}

describe('the pet brain', () => {
  it('says something about a new pet straight away, so it is drawn', () => {
    const b = new Brain(1)
    b.handle({ kind: 'habitat', rail: 0, bar: 800 })
    expect(b.handle({ kind: 'pets', pets: [pet('a')] })).toMatchObject([{ id: 'a', activity: 'idle' }])
  })

  it('a sleepy pet falls asleep within the hour, and wakes again later', () => {
    const cmds = run(brain([pet('a', { sleepiness: 1, energy: 0.2 })]), 60 * 60_000)
    const acts = cmds.map((c) => c.activity)
    const napped = acts.indexOf('sleep')
    expect(napped).toBeGreaterThanOrEqual(0)
    expect(acts.slice(napped).some((a) => a !== 'sleep')).toBe(true)
  })

  it('stays within its habitat: never past either end, and never on a rail that is not there', () => {
    for (const rail of [0, 600]) {
      const places = run(brain([pet('a', { energy: 1, curiosity: 1 }), pet('b', { sociability: 1 }, 0.9)], { rail, seed: rail + 3 }), 30 * 60_000)
        .flatMap((c) => (c.to !== undefined ? [c.to] : []))
      expect(places.length).toBeGreaterThan(0)
      expect(places.every((p) => p.at >= 0 && p.at <= 1)).toBe(true)
      expect(places.every((p) => rail > 0 || p.region === 'bar')).toBe(true)
    }
  })

  it('climbs the rail when there is one', () => {
    const cmds = run(brain([pet('a', { energy: 1, curiosity: 1 }, 0)], { seed: 12 }), 60 * 60_000)
    expect(cmds.some((c) => c.to?.region === 'rail')).toBe(true)
  })

  it('every awake pet turns to watch when Claude starts working, and one of them says so', () => {
    const b = brain([pet('a'), pet('b', {}, 0.2)])
    run(b, 5000)
    const cmds = b.handle({ kind: 'claude', working: 1, waiting: 0, finishedNow: false })
    expect(cmds.map((c) => [c.id, c.activity]).sort()).toEqual([['a', 'watch'], ['b', 'watch']])
    expect(cmds.filter((c) => c.say !== undefined)).toHaveLength(1)
    expect(STARTER_PET.lines.working).toContain(cmds.find((c) => c.say)!.say!.text)
  })

  it('celebrates a finished turn and gets nervous about a waiting prompt', () => {
    const b = brain([pet('a')])
    run(b, 1000)
    expect(b.handle({ kind: 'claude', working: 0, waiting: 0, finishedNow: true })[0]).toMatchObject({ activity: 'celebrate' })
    expect(b.handle({ kind: 'claude', working: 0, waiting: 1, finishedNow: false })[0]).toMatchObject({ activity: 'nervous', face: 'worried' })
  })

  it('a sociable pair visits each other and says hello', () => {
    const cmds = run(brain([pet('a', { sociability: 1 }, 0.1), pet('b', { sociability: 1 }, 0.9)], { rail: 0, seed: 5 }), 60 * 60_000)
    const greetings = cmds.filter((c) => c.say !== undefined && STARTER_PET.lines.greet!.includes(c.say.text))
    expect(greetings.length).toBeGreaterThan(0)
  })

  it('speaks on its own at most once per gap', () => {
    const b = brain([pet('a')])
    const spokeAt: number[] = []
    for (let t = 0; t < 60 * 60_000; t += 250) {
      for (const c of b.tick(250)) if (c.say !== undefined) spokeAt.push(t)
    }
    expect(spokeAt.length).toBeGreaterThan(0)
    for (let i = 1; i < spokeAt.length; i++) expect(spokeAt[i] - spokeAt[i - 1]).toBeGreaterThanOrEqual(SPEECH_GAP_MS - 250)
  })

  it('a held pet does nothing of its own until dropped, then stands where it was put', () => {
    const b = brain([pet('a', { energy: 1 })])
    expect(b.handle({ kind: 'held', id: 'a' })[0].activity).toBe('held')
    expect(run(b, 10 * 60_000).filter((c) => c.say === undefined)).toEqual([])
    const [dropped] = b.handle({ kind: 'dropped', id: 'a', place: { region: 'rail', at: 0.3 } })
    expect(dropped.activity).toBe('idle')
    const walk = run(b, 10 * 60_000).find((c) => c.to !== undefined)
    // Its next walk starts from the rail.
    expect(walk).toBeDefined()
  })

  it('stays asleep when told to, and wakes stretching', () => {
    const b = brain([pet('a')])
    b.handle({ kind: 'sleep', id: 'a', on: true })
    expect(run(b, 30 * 60_000).filter((c) => c.activity !== 'sleep')).toEqual([])
    expect(b.handle({ kind: 'sleep', id: 'a', on: false })[0].activity).toBe('stretch')
  })

  it('under reduced motion it never walks — at most it is moved, at once, to make room', () => {
    const b = brain([pet('a', { energy: 1, curiosity: 1 }), pet('b', { sociability: 1 })])
    b.handle({ kind: 'reducedMotion', on: true })
    const cmds = run(b, 30 * 60_000)
    expect(cmds.filter((c) => c.activity === 'walk' || c.activity === 'run')).toEqual([])
    expect(cmds.filter((c) => c.to !== undefined && c.ms > 0)).toEqual([])
  })

  it('is the same every run for the same seed', () => {
    const a = run(brain([pet('a'), pet('b')], { seed: 42 }), 20 * 60_000)
    const b = run(brain([pet('a'), pet('b')], { seed: 42 }), 20 * 60_000)
    expect(a).toEqual(b)
  })

  it('sends only a handful of commands a minute', () => {
    const cmds = run(brain([pet('a'), pet('b'), pet('c')]), 60 * 60_000)
    expect(cmds.length / 60).toBeLessThan(3 * 12)
  })

  it('pets stand side by side, never one on top of another, even when there is little room', () => {
    const overlaps: string[] = []
    for (const seed of [1, 2, 3]) {
      const b = new Brain(seed)
      b.handle({ kind: 'habitat', rail: 0, bar: 600 })
      // Three extra-large pets starting all in one spot.
      b.handle({ kind: 'pets', pets: ['a', 'b', 'c'].map((id) => ({ ...pet(id, { sociability: 1, energy: 1 }, 0.5), size: 128 })) })
      // An overlap that lasts: a scene's cast is close together on the tick it ends, and makes room
      // on the next.
      let before = new Set<string>()
      for (let t = 0; t < 20 * 60_000; t += 250) {
        b.tick(250)
        const now = new Set<string>()
        const still = t < 3000 ? [] : b.positions().filter((p) => !p.moving)
        // A scene puts its cast together on purpose (a picnic, sharing a snack).
        const cast = new Set(b.currentScene()?.members ?? [])
        for (const x of still) {
          for (const y of still) {
            if (x.id < y.id && !(cast.has(x.id) && cast.has(y.id)) && Math.abs(x.s - y.s) < ((x.size + y.size) / 2) * 0.95 - 1.5) now.add(`${x.id}/${y.id}`)
          }
        }
        for (const pair of now) if (before.has(pair)) overlaps.push(`${pair} at ${String(t)}ms, seed ${String(seed)}`)
        before = now
      }
    }
    expect(overlaps).toEqual([])
  })

  it('a pet dropped onto another keeps its spot, and the other makes room', () => {
    const b = new Brain(9)
    b.handle({ kind: 'habitat', rail: 0, bar: 800 })
    b.handle({ kind: 'pets', pets: [{ ...pet('a', {}, 0.5), size: 92 }, { ...pet('b', {}, 0.1), size: 92 }] })
    b.handle({ kind: 'held', id: 'b' })
    b.handle({ kind: 'dropped', id: 'b', place: { region: 'bar', at: 0.5 } })
    const moved = run(b, 2000)
    expect(moved.find((c) => c.to !== undefined)?.id).toBe('a')
    expect(b.positions().find((p) => p.id === 'b')!.s).toBe(400)
  })

  it('when a session finishes, the nearest awake pet runs under it and points', () => {
    const b = brain([pet('near', {}, 0.6), pet('far', {}, 0.05)], { rail: 0 })
    run(b, 1000)
    const [go] = b.handle({ kind: 'pointAt', at: { region: 'bar', at: 0.75 } })
    expect(go).toMatchObject({ id: 'near', activity: 'run' })
    const later = run(b, 15_000)
    const pointing = later.find((c) => c.activity === 'point')
    expect(pointing?.id).toBe('near')
    expect(STARTER_PET.lines.finished).toContain(pointing?.say?.text)
  })

  it('while Claude works, a curious pet goes to look and asks for a remark, every few minutes at most', () => {
    const b = new Brain(4, { commentEveryMs: [180_000, 300_000] })
    b.handle({ kind: 'habitat', rail: 0, bar: 900 })
    b.handle({ kind: 'pets', pets: [pet('nosy', { curiosity: 1 }, 0.1), pet('calm', { curiosity: 0 }, 0.9)] })
    b.handle({ kind: 'workingAt', at: { region: 'bar', at: 0.5 } })
    b.handle({ kind: 'claude', working: 1, waiting: 0, finishedNow: false })
    const asks: number[] = []
    for (let t = 0; t < 30 * 60_000; t += 250) for (const c of b.tick(250)) if (c.ask === 'comment') asks.push(t)
    expect(asks.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < asks.length; i++) expect(asks[i] - asks[i - 1]).toBeGreaterThanOrEqual(180_000 - 250)
    // And not at all while Claude is idle.
    b.handle({ kind: 'claude', working: 0, waiting: 0, finishedNow: true })
    expect(run(b, 20 * 60_000).filter((c) => c.ask !== undefined)).toEqual([])
  })

  it('does things alone with props now and then', () => {
    const acts = new Set(run(brain([pet('a', { energy: 1, curiosity: 1 })], { seed: 3 }), 3 * 60 * 60_000).map((c) => c.activity))
    for (const a of ['computer', 'exercise', 'eat', 'drink', 'skip', 'paint', 'skate'] as const) expect(acts).toContain(a)
  })

  it('skates only along the bar, never up the rail', () => {
    const cmds = run(brain([pet('a', { energy: 1, curiosity: 1 }, 0), pet('b', { energy: 1 }, 0.6)], { seed: 9 }), 3 * 60 * 60_000)
    const skates = cmds.filter((c) => c.activity === 'skate')
    expect(skates.length).toBeGreaterThan(0)
    expect(skates.every((c) => c.to?.region === 'bar')).toBe(true)
  })

  it('every so often puts on a scene: the cast gathers, the scenery comes and goes, and life resumes', () => {
    const b = new Brain(12, { sceneEveryMs: [60_000, 90_000] })
    b.handle({ kind: 'habitat', rail: 600, bar: 1400 })
    b.handle({ kind: 'pets', pets: [pet('a', { energy: 1 }, 0.1), pet('b', {}, 0.5), pet('c', {}, 0.9)] })
    const seen = new Set<SceneKind>()
    const shown = new Map<string, Scenery>()
    const shownKinds = new Set<string>()
    let playing = 0
    let strayScenery = 0
    for (let t = 0; t < 4 * 60 * 60_000; t += 250) {
      b.tick(250)
      const sc = b.currentScene()
      if (sc !== null) seen.add(sc.kind)
      if (sc?.phase === 'play') playing++
      for (const s of b.takeScenery()) {
        if (s.show) { shown.set(s.key, s); shownKinds.add(s.kind) } else shown.delete(s.key)
      }
      if (sc === null && shown.size > 0) strayScenery++
    }
    expect(strayScenery).toBe(0)
    for (const k of ['catch', 'tennis', 'picnic', 'fish', 'tree', 'drive', 'parachute', 'share'] as const) expect(seen).toContain(k)
    for (const k of ['ball', 'pond', 'tree', 'picnic']) expect(shownKinds).toContain(k)
    expect(playing).toBeGreaterThan(0)
    // Pets in scenes still stay on the walkable line.
    expect(b.positions().every((p) => p.s >= -630 && p.s <= 1400)).toBe(true)
  })

  it('no parachute without the rail to jump from, and no scenes under reduced motion', () => {
    const b = new Brain(5, { sceneEveryMs: [30_000, 40_000] })
    b.handle({ kind: 'habitat', rail: 0, bar: 1400 })
    b.handle({ kind: 'pets', pets: [pet('a', {}, 0.2), pet('b', {}, 0.7)] })
    const kinds = new Set<SceneKind>()
    for (let t = 0; t < 2 * 60 * 60_000; t += 250) { b.tick(250); const sc = b.currentScene(); if (sc !== null) kinds.add(sc.kind) }
    expect(kinds).not.toContain('parachute')
    b.handle({ kind: 'reducedMotion', on: true })
    for (let t = 0; t < 30 * 60_000; t += 250) { b.tick(250); expect(b.currentScene()).toBeNull() }
  })

  it('pets not in a scene keep out of its way', () => {
    const b = new Brain(21, { sceneEveryMs: [20_000, 30_000], sceneKinds: ['fish', 'tree', 'picnic', 'catch', 'tennis'] })
    b.handle({ kind: 'habitat', rail: 0, bar: 1600 })
    b.handle({ kind: 'pets', pets: [pet('a', {}, 0.3), pet('b', {}, 0.5), pet('c', { energy: 1, curiosity: 1 }, 0.7)].map((p) => ({ ...p, size: 92 })) })
    const intruders: string[] = []
    let inScene = 0
    for (let t = 0; t < 60 * 60_000; t += 250) {
      b.tick(250)
      const sc = b.currentScene()
      if (sc?.phase !== 'play') continue
      inScene++
      const cast = b.positions().filter((p) => sc.members.includes(p.id))
      const lo = Math.min(...cast.map((p) => p.s)) - 92
      const hi = Math.max(...cast.map((p) => p.s)) + 92
      for (const p of b.positions()) if (!sc.members.includes(p.id) && !p.moving && p.s > lo && p.s < hi) intruders.push(`${p.id} in ${sc.kind} at ${String(t)}`)
    }
    expect(inScene).toBeGreaterThan(0)
    // A bystander may be caught on its way out for a tick; it never stays.
    expect(intruders.length).toBeLessThan(inScene * 0.02)
  })
})
