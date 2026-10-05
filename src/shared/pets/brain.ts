import type { PetSpec, Situation } from './spec'
import type { PetPlace } from './state'

/**
 * What the pets do, decided away from the page: this runs in a Web Worker
 * (`renderer/features/pets/petBrain.worker.ts`) and answers in a few small commands a minute. The
 * page turns each command into a CSS transition, so a pet walking costs the main thread nothing
 * per frame. Pure and seeded, so a test can replay an hour of a pet's life.
 *
 * Each pet has needs that drift — energy (falls while awake, refills asleep), boredom (rises while
 * still), social (rises alone) — and its traits weight what it picks next: a sleepy pet naps
 * sooner, a curious one watches Claude longer and peeks at its work, a sociable one visits. Claude
 * starting work turns the pets to watch; a finished turn sends one running to point at it; a
 * waiting permission prompt, a nervous nudge.
 *
 * Every 10–20 minutes a scene (`SCENES`) brings out something special for about a minute: a game
 * of catch or tennis, a picnic, fishing at a pond, reading under a tree, a drive, a parachute jump
 * off the rail. Scenery and the ball are announced separately (`takeScenery`).
 */

export type Activity =
  | 'idle' | 'walk' | 'run' | 'sit' | 'read' | 'sleep' | 'stretch' | 'wave' | 'dance'
  | 'watch' | 'celebrate' | 'nervous' | 'held'
  // Pointing up at the session that just finished.
  | 'point'
  // Things to do alone, each with a prop.
  | 'computer' | 'exercise' | 'eat' | 'drink' | 'skip' | 'paint'
  // Along the status bar on a skateboard.
  | 'skate'
  // Parts of scenes.
  | 'carry' | 'catch' | 'tennis' | 'fish' | 'fishcaught' | 'drive' | 'climb' | 'parachute'
export type Face = 'happy' | 'sleepy' | 'surprised' | 'focused' | 'love' | 'worried'

export interface BrainPet {
  id: string
  traits: PetSpec['traits']
  lines: PetSpec['lines']
  place: PetPlace
  size: number
}

export type BrainEvent =
  | { kind: 'pets'; pets: BrainPet[] }
  | { kind: 'habitat'; rail: number; bar: number }
  | { kind: 'held'; id: string }
  | { kind: 'dropped'; id: string; place: PetPlace }
  | { kind: 'poke'; id: string }
  | { kind: 'claude'; working: number; waiting: number; finishedNow: boolean }
  /** A session just finished; this is the spot on the bar under its pane. */
  | { kind: 'pointAt'; at: PetPlace }
  /** Where a session is working (under its pane), or null when none is in this window. */
  | { kind: 'workingAt'; at: PetPlace | null }
  | { kind: 'sleep'; id: string; on: boolean }
  | { kind: 'reducedMotion'; on: boolean }
  | { kind: 'hour'; hour: number }

export interface Command {
  id: string
  activity: Activity
  face: Face
  /** Walk (or run) there over `ms`; absent when the pet stays put. */
  to?: PetPlace
  ms: number
  facing: 'left' | 'right'
  say?: { text: string; kind: 'speech' | 'thought' }
  /** The page should ask the pet's model for a remark on what Claude is doing, and show it. */
  ask?: 'comment'
}

export type SceneryKind = 'ball' | 'pond' | 'tree' | 'picnic'

/** Something in the habitat that is not a pet: shown for a scene, then taken away. */
export interface Scenery {
  key: string
  kind: SceneryKind
  show: boolean
  at: PetPlace
  /** The ball flies between `at` and `to`, there and back every `ms`. */
  to?: PetPlace
  ms?: number
  style?: 'catch' | 'tennis'
}

export type SceneKind = 'catch' | 'tennis' | 'share' | 'picnic' | 'fish' | 'tree' | 'drive' | 'parachute'

/** The gap between a pet's own idle remarks, at least. Events (a finished turn) may speak sooner. */
export const SPEECH_GAP_MS = 120_000
const EVENT_SPEECH_GAP_MS = 20_000
/** Across all pets, so three pets do not chatter at once. */
const ANY_SPEECH_GAP_MS = 30_000
const WALK_PX_PER_S = 28
const RUN_PX_PER_S = 90
const DRIVE_PX_PER_S = 150
const SKATE_PX_PER_S = 110
const PARACHUTE_PX_PER_S = 55
const CLIMB_PX_PER_S = 90
/** Pixels between the rail's foot and the bar's corner, counted in walks. */
const HOP_PX = 30
/** How often a pet peeks at Claude's work and remarks on it, at most (main throttles too). */
export const COMMENT_EVERY_MS: [number, number] = [3 * 60_000, 5 * 60_000]
/** How often something special happens, and for how long. */
export const SCENE_EVERY_MS: [number, number] = [10 * 60_000, 20 * 60_000]
const SCENE_PLAY_MS: [number, number] = [45_000, 75_000]

interface PetMind {
  pet: BrainPet
  activity: Activity
  face: Face
  facing: 'left' | 'right'
  left: number
  energy: number
  boredom: number
  social: number
  sinceSpoke: number
  forcedSleep: boolean
  /** Since it was dropped by hand: a pet put somewhere on purpose keeps that spot for a while. */
  sinceDropped: number
}

interface Scene {
  kind: SceneKind
  members: string[]
  /** Walking into place, then playing; `left` counts down the current phase. */
  phase: 'gather' | 'play'
  left: number
  /** The middle of the scene along the walkable line. */
  centre: number
  scenery: Scenery[]
  /** For a drive: the turns still to make. */
  legs: number[]
  /** Fishing: whether the fish has been landed yet. */
  landed: boolean
  /** The stretch it takes up, scenery and all, which other pets keep out of. */
  zone: [number, number]
}

/** mulberry32: small, fast, seeded. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MOVING: ReadonlySet<Activity> = new Set(['walk', 'run', 'carry', 'drive', 'climb', 'parachute', 'skate'])
const ACTIVE: ReadonlySet<Activity> = new Set(['walk', 'run', 'dance', 'celebrate', 'stretch', 'wave', 'exercise', 'skip', 'catch', 'tennis', 'climb', 'skate'])
const STILL: ReadonlySet<Activity> = new Set(['idle', 'sit', 'watch', 'nervous'])

type Errand = 'greet' | 'point' | 'comment'

export interface BrainOptions {
  /** Overrides for tests: how often scenes and remarks come round. */
  sceneEveryMs?: [number, number]
  commentEveryMs?: [number, number]
  /** Only these scenes (to look at one). */
  sceneKinds?: SceneKind[]
}

export class Brain {
  private readonly rand: () => number
  private readonly minds = new Map<string, PetMind>()
  private rail = 0
  private bar = 600
  private working = 0
  private waiting = 0
  private workingAt: PetPlace | null = null
  private reducedMotion = false
  private hour = 12
  private sinceAnySpoke = Infinity
  /** What `speak` last chose, picked up by whoever builds the command. */
  private lastSaid: Command['say'] | null = null
  /** Pets on an errand, which do it when they arrive. */
  private readonly afterWalk = new Map<string, Errand>()
  private scene: Scene | null = null
  private untilScene: number
  private untilComment: number
  private sceneCount = 0
  private readonly sceneryOut: Scenery[] = []
  private readonly sceneEvery: [number, number]
  private readonly commentEvery: [number, number]
  private readonly sceneKinds: SceneKind[] | null

  constructor(seed: number, opts: BrainOptions = {}) {
    this.rand = rng(seed)
    this.sceneEvery = opts.sceneEveryMs ?? SCENE_EVERY_MS
    this.commentEvery = opts.commentEveryMs ?? COMMENT_EVERY_MS
    this.sceneKinds = opts.sceneKinds ?? null
    this.untilScene = this.between(...this.sceneEvery)
    this.untilComment = this.between(...this.commentEvery)
  }

  private between(lo: number, hi: number): number { return lo + this.rand() * (hi - lo) }

  /** Scenery shown or taken away since the last call. */
  takeScenery(): Scenery[] { return this.sceneryOut.splice(0) }

  // -- the walkable line: bar from the corner (0..bar px), rail below zero (−hop..−hop−rail px)

  private toS(p: PetPlace): number {
    if (p.region === 'rail' && this.rail > 0) return -(HOP_PX + p.at * this.rail)
    return Math.min(1, Math.max(0, p.at)) * this.bar
  }

  private fromS(s: number): PetPlace {
    if (s < 0 && this.rail > 0) {
      const up = Math.min(this.rail, Math.max(0, -s - HOP_PX))
      return { region: 'rail', at: up / this.rail }
    }
    return { region: 'bar', at: this.bar > 0 ? Math.min(1, Math.max(0, s / this.bar)) : 0 }
  }

  private minS(): number { return this.rail > 0 ? -(HOP_PX + this.rail) : 0 }

  private inScene(m: PetMind): boolean { return this.scene?.members.includes(m.pet.id) === true }

  private awake(m: PetMind): boolean { return m.activity !== 'sleep' && m.activity !== 'held' && !m.forcedSleep }

  // -- events and time

  handle(e: BrainEvent): Command[] {
    switch (e.kind) {
      case 'pets': return this.syncPets(e.pets)
      case 'habitat': {
        this.rail = Math.max(0, e.rail)
        this.bar = Math.max(0, e.bar)
        // A pet on a rail that has gone is already drawn at the corner by the page; keep its mind there too.
        if (this.rail === 0) for (const m of this.minds.values()) if (m.pet.place.region === 'rail') m.pet.place = { region: 'bar', at: 0 }
        return []
      }
      case 'held': {
        const m = this.minds.get(e.id)
        const out = m !== undefined && this.inScene(m) ? this.endScene() : []
        return [...out, ...this.set(e.id, (p) => { this.become(p, 'held', 'surprised', 1e12) })]
      }
      case 'dropped': return this.set(e.id, (m) => {
        m.pet.place = e.place
        m.sinceDropped = 0
        this.become(m, 'idle', 'happy', this.between(2000, 5000))
      })
      case 'poke': return this.set(e.id, (m) => {
        if (m.activity === 'sleep') m.forcedSleep = false
        if (this.inScene(m)) return
        this.become(m, 'wave', 'love', 1800)
        this.speak(m, 'petted', 'speech', EVENT_SPEECH_GAP_MS)
      })
      case 'sleep': return this.set(e.id, (m) => {
        m.forcedSleep = e.on
        if (e.on) this.become(m, 'sleep', 'sleepy', 1e12)
        else this.become(m, 'stretch', 'happy', 2000)
      })
      case 'reducedMotion': this.reducedMotion = e.on; return e.on && this.scene !== null ? this.endScene() : []
      case 'hour': this.hour = e.hour; return []
      case 'claude': return this.onClaude(e)
      case 'workingAt': this.workingAt = e.at; return []
      case 'pointAt': return this.pointAt(e.at)
    }
  }

  tick(dtMs: number): Command[] {
    const out: Command[] = []
    this.sinceAnySpoke += dtMs
    const s = dtMs / 1000
    for (const m of this.minds.values()) {
      m.sinceSpoke += dtMs
      m.sinceDropped += dtMs
      if (m.activity === 'sleep') m.energy = Math.min(1, m.energy + 0.004 * s)
      else m.energy = Math.max(0, m.energy - (ACTIVE.has(m.activity) ? 0.0016 : 0.0008) * s)
      if (STILL.has(m.activity) || m.activity === 'read') m.boredom = Math.min(1, m.boredom + 0.004 * s)
      m.social = Math.min(1, m.social + 0.002 * (0.5 + m.pet.traits.sociability) * s)
      if (m.activity === 'held' || m.forcedSleep) continue
      m.left -= dtMs
      // A pet in a scene is the scene's to move (`runScene`).
      if (this.inScene(m)) continue
      const before = out.length
      if (this.crowding(m)) out.push(this.makeRoom(m))
      else if (m.left <= 0) out.push(...this.next(m))
      // Something to say now and then, in the mood of the moment, if nothing else was said.
      if (out.length === before && m.sinceSpoke >= SPEECH_GAP_MS && this.sinceAnySpoke >= ANY_SPEECH_GAP_MS && this.rand() < 0.02 * s) {
        const situation: Situation = m.activity === 'sleep' ? 'sleepy' : this.working > 0 ? 'working' : 'idle'
        const kind = situation === 'working' ? 'speech' : this.rand() < 0.5 ? 'thought' : 'speech'
        const said = this.line(m, situation)
        if (said !== null) {
          m.sinceSpoke = 0
          this.sinceAnySpoke = 0
          out.push({ ...this.command(m), say: { text: said, kind } })
        }
      }
    }
    out.push(...this.peek(dtMs))
    out.push(...this.runScene(dtMs))
    return out
  }

  /** Where every pet is (or is headed) along the walkable line, for tests. */
  positions(): { id: string; s: number; size: number; moving: boolean; activity: Activity }[] {
    return [...this.minds.values()].map((m) => ({ id: m.pet.id, s: this.toS(m.pet.place), size: m.pet.size, moving: MOVING.has(m.activity), activity: m.activity }))
  }

  /** The scene under way, for tests. */
  currentScene(): { kind: SceneKind; members: string[]; phase: 'gather' | 'play' } | null {
    return this.scene === null ? null : { kind: this.scene.kind, members: [...this.scene.members], phase: this.scene.phase }
  }

  // -- internals

  /** Applies an event to one pet; whatever it said on the way rides along with the command. */
  private set(id: string, fn: (m: PetMind) => void): Command[] {
    const m = this.minds.get(id)
    if (m === undefined) return []
    this.lastSaid = null
    fn(m)
    return [this.withSaid(m)]
  }

  /** The pet's command, with whatever `speak` just chose for it. */
  private withSaid(m: PetMind, to?: PetPlace, ms = 0): Command {
    const said = this.lastSaid
    this.lastSaid = null
    const cmd = this.command(m, to, ms)
    return said !== null ? { ...cmd, say: said } : cmd
  }

  private become(m: PetMind, activity: Activity, face: Face, ms: number): void {
    m.activity = activity
    m.face = face
    m.left = ms
  }

  private command(m: PetMind, to?: PetPlace, ms = 0): Command {
    return stripUndefined({ id: m.pet.id, activity: m.activity, face: m.face, ms, facing: m.facing, ...(to !== undefined ? { to } : {}) })
  }

  private line(m: PetMind, situation: Situation): string | null {
    const lines = m.pet.lines[situation] ?? m.pet.lines.idle ?? []
    if (lines.length === 0) return null
    return lines[Math.floor(this.rand() * lines.length)]
  }

  /** Says a line for the situation if the pet has not spoken within `gap`. */
  private speak(m: PetMind, situation: Situation, kind: 'speech' | 'thought', gap: number): void {
    if (m.sinceSpoke < gap) return
    const text = this.line(m, situation)
    if (text === null) return
    m.sinceSpoke = 0
    this.sinceAnySpoke = 0
    this.lastSaid = { text, kind }
  }

  private syncPets(pets: BrainPet[]): Command[] {
    const out: Command[] = []
    const ids = new Set(pets.map((p) => p.id))
    for (const id of [...this.minds.keys()]) if (!ids.has(id)) this.minds.delete(id)
    if (this.scene !== null && this.scene.members.some((id) => !ids.has(id))) out.push(...this.endScene())
    for (const pet of pets) {
      const known = this.minds.get(pet.id)
      if (known !== undefined) {
        // Traits, lines and size may have changed; where it stands is the brain's own business
        // unless it has none yet.
        known.pet = { ...pet, place: known.pet.place }
        continue
      }
      const m: PetMind = {
        pet, activity: 'idle', face: 'happy', facing: this.rand() < 0.5 ? 'left' : 'right',
        left: this.between(1500, 4000),
        energy: 0.6 + 0.4 * (1 - pet.traits.sleepiness), boredom: 0.2, social: 0.2,
        sinceSpoke: SPEECH_GAP_MS * 0.5, forcedSleep: false, sinceDropped: Infinity,
      }
      this.minds.set(pet.id, m)
      out.push(this.command(m))
    }
    return out
  }

  private onClaude(e: { working: number; waiting: number; finishedNow: boolean }): Command[] {
    const out: Command[] = []
    const started = e.working > 0 && this.working === 0
    const newlyWaiting = e.waiting > this.waiting
    this.working = e.working
    this.waiting = e.waiting
    if (started) this.untilComment = Math.min(this.untilComment, this.between(20_000, 60_000))
    // Pets busy with a scene or an errand carry on; the rest react.
    const free = [...this.minds.values()].filter((m) => this.awake(m) && !this.inScene(m) && !this.afterWalk.has(m.pet.id))
    // One pet speaks for the group, so a finished turn is one cheer, not three.
    const voice = free.length > 0 ? free[Math.floor(this.rand() * free.length)] : undefined
    for (const m of free) {
      this.lastSaid = null
      if (newlyWaiting) {
        this.become(m, 'nervous', 'worried', 3500)
        if (m === voice) this.speak(m, 'waiting', 'speech', EVENT_SPEECH_GAP_MS)
      } else if (e.finishedNow) {
        this.become(m, 'celebrate', 'happy', 3000)
        if (m === voice) this.speak(m, 'finished', 'speech', EVENT_SPEECH_GAP_MS)
      } else if (started) {
        this.become(m, 'watch', 'focused', this.between(8000, 20000) * (0.5 + m.pet.traits.curiosity))
        if (m === voice) this.speak(m, 'working', 'speech', EVENT_SPEECH_GAP_MS)
      } else {
        continue
      }
      out.push(m === voice ? this.withSaid(m) : this.command(m))
    }
    this.lastSaid = null
    return out
  }

  /** A session finished: the nearest awake pet runs under it and points, to get your attention. */
  private pointAt(at: PetPlace): Command[] {
    if (this.reducedMotion) return []
    const target = this.toS(at)
    let candidates = [...this.minds.values()].filter((m) => this.awake(m) && !this.inScene(m))
    const out: Command[] = []
    if (candidates.length === 0 && this.scene !== null) {
      // Everyone is busy playing: this matters more.
      out.push(...this.endScene())
      candidates = [...this.minds.values()].filter((m) => this.awake(m))
    }
    if (candidates.length === 0) return out
    candidates.sort((a, b) => Math.abs(this.toS(a.pet.place) - target) - Math.abs(this.toS(b.pet.place) - target))
    const m = candidates[0]
    this.afterWalk.set(m.pet.id, 'point')
    out.push(this.walkTo(m, this.freeSpot(m, target), 'run', RUN_PX_PER_S))
    return out
  }

  /** Now and then while Claude works, a curious pet goes to look and says what it thinks. */
  private peek(dtMs: number): Command[] {
    if (this.working === 0) return []
    this.untilComment -= dtMs
    if (this.untilComment > 0) return []
    this.untilComment = this.between(...this.commentEvery)
    const free = [...this.minds.values()].filter((m) => this.awake(m) && !this.inScene(m) && !this.afterWalk.has(m.pet.id) && !MOVING.has(m.activity))
    if (free.length === 0) return []
    // The most curious goes, more often than not.
    free.sort((a, b) => b.pet.traits.curiosity - a.pet.traits.curiosity)
    const m = this.rand() < 0.7 ? free[0] : free[Math.floor(this.rand() * free.length)]
    if (this.workingAt === null || this.reducedMotion) {
      this.become(m, 'watch', 'focused', 6000)
      return [{ ...this.command(m), ask: 'comment' }]
    }
    this.afterWalk.set(m.pet.id, 'comment')
    return [this.walkTo(m, this.freeSpot(m, this.toS(this.workingAt)), 'walk', WALK_PX_PER_S * 1.6)]
  }

  /** Chooses what a pet does next, weighted by its needs and traits. */
  private next(m: PetMind): Command[] {
    const errand = this.afterWalk.get(m.pet.id)
    this.afterWalk.delete(m.pet.id)
    if (errand === 'point') {
      // Arrived under a finished session: point at it, with a hop, and say so.
      this.become(m, 'point', 'happy', 5000)
      this.speak(m, 'finished', 'speech', 0)
      return [this.withSaid(m)]
    }
    if (errand === 'comment') {
      this.become(m, 'watch', 'focused', 6000)
      return [{ ...this.command(m), ask: 'comment' }]
    }
    if (errand === 'greet' && !this.reducedMotion) {
      this.become(m, 'wave', 'happy', 2000)
      this.speak(m, 'greet', 'speech', EVENT_SPEECH_GAP_MS)
      return [this.withSaid(m)]
    }
    const t = m.pet.traits
    const night = this.hour >= 23 || this.hour < 6
    const others = [...this.minds.values()].filter((o) => o !== m)
    const weights: [Activity | 'visit', number][] = [
      ['sleep', (m.energy < 0.25 ? 6 : m.energy < 0.5 ? 0.6 : 0.05) * (0.5 + t.sleepiness) * (night ? 2.5 : 1)],
      ['watch', this.working > 0 ? 4 * (0.4 + t.curiosity) : 0],
      ['walk', (0.6 + m.boredom * 2) * (0.5 + t.curiosity)],
      ['run', m.energy > 0.5 ? m.boredom * 1.5 * (0.2 + t.energy) : 0],
      ['dance', m.energy > 0.4 ? 0.3 * (0.2 + t.energy) : 0],
      ['visit', others.length > 0 ? m.social * 2 * (0.2 + t.sociability) : 0],
      ['idle', 1],
      ['sit', 0.8],
      ['read', 0.5 * (0.5 + t.curiosity) * (1 - m.boredom)],
      ['stretch', m.activity === 'sleep' ? 3 : 0.25],
      ['computer', 0.35 * (0.5 + t.curiosity) + (this.working > 0 ? 0.4 : 0)],
      ['exercise', m.energy > 0.5 ? 0.3 * (0.3 + t.energy) : 0],
      ['eat', 0.25 + (this.hour === 12 || this.hour === 18 ? 0.4 : 0)],
      ['drink', 0.2],
      ['skip', m.energy > 0.6 ? 0.25 * (0.3 + t.energy) : 0],
      ['paint', 0.25 * (0.4 + t.curiosity)],
      // Only along the bar: a board does not go up the rail.
      ['skate', m.energy > 0.5 && this.toS(m.pet.place) >= 0 ? 0.3 * (0.2 + t.energy) * (0.5 + m.boredom) : 0],
    ]
    const total = weights.reduce((a, [, w]) => a + w, 0)
    let r = this.rand() * total
    let pick: Activity | 'visit' = 'idle'
    for (const [a, w] of weights) { r -= w; if (r <= 0) { pick = a; break } }
    if (this.reducedMotion && (pick === 'walk' || pick === 'run' || pick === 'visit' || pick === 'dance' || pick === 'exercise' || pick === 'skip' || pick === 'skate')) pick = 'sit'

    switch (pick) {
      case 'walk':
      case 'run': {
        const here = this.toS(m.pet.place)
        const reach = pick === 'run' ? 400 : 180
        const target = this.freeSpot(m, here + this.between(-reach, reach))
        m.boredom = Math.max(0, m.boredom - 0.5)
        return [this.walkTo(m, target, pick, pick === 'run' ? RUN_PX_PER_S : WALK_PX_PER_S * (0.7 + t.energy))]
      }
      case 'skate': {
        const here = this.toS(m.pet.place)
        const half = m.pet.size / 2
        const target = this.freeSpot(m, Math.min(this.bar - half, Math.max(half, here + (this.rand() < 0.5 ? -1 : 1) * this.between(160, 420))), 0)
        m.boredom = 0
        return [this.walkTo(m, target, 'skate', SKATE_PX_PER_S)]
      }
      case 'visit': {
        const friend = others[Math.floor(this.rand() * others.length)]
        const there = this.toS(friend.pet.place)
        const here = this.toS(m.pet.place)
        const gap = this.gap(m, friend) + 6
        const target = this.freeSpot(m, here < there ? there - gap : there + gap)
        m.social = 0
        this.afterWalk.set(m.pet.id, 'greet')
        return [this.walkTo(m, target, 'walk', WALK_PX_PER_S * 1.3)]
      }
      case 'sleep': this.become(m, 'sleep', 'sleepy', this.between(40_000, 120_000)); break
      case 'watch': this.become(m, 'watch', 'focused', this.between(8000, 20000)); break
      case 'dance': this.become(m, 'dance', 'love', this.between(3000, 5000)); m.boredom = 0; break
      case 'read': this.become(m, 'read', 'focused', this.between(15_000, 40_000)); break
      case 'sit': this.become(m, 'sit', 'happy', this.between(6000, 15_000)); break
      case 'stretch': this.become(m, 'stretch', 'happy', 2000); break
      case 'computer': this.become(m, 'computer', 'focused', this.between(15_000, 35_000)); break
      case 'exercise': this.become(m, 'exercise', 'focused', this.between(8000, 15_000)); m.boredom = 0; break
      case 'eat': this.become(m, 'eat', 'love', this.between(8000, 14_000)); break
      case 'drink': this.become(m, 'drink', 'happy', this.between(5000, 8000)); break
      case 'skip': this.become(m, 'skip', 'happy', this.between(6000, 10_000)); m.boredom = 0; break
      case 'paint': this.become(m, 'paint', 'focused', this.between(15_000, 30_000)); break
      case 'idle': case 'wave': case 'celebrate': case 'nervous': case 'held': case 'point':
      case 'carry': case 'catch': case 'tennis': case 'fish': case 'fishcaught': case 'drive': case 'climb': case 'parachute':
        this.become(m, 'idle', 'happy', this.between(3000, 8000))
    }
    return [this.command(m)]
  }

  // -- scenes

  private runScene(dtMs: number): Command[] {
    if (this.scene === null) {
      if (this.reducedMotion) return []
      this.untilScene -= dtMs
      if (this.untilScene > 0) return []
      this.untilScene = this.between(...this.sceneEvery)
      return this.startScene()
    }
    const sc = this.scene
    sc.left -= dtMs
    const members = sc.members.map((id) => this.minds.get(id)).filter((m): m is PetMind => m !== undefined)
    if (sc.phase === 'gather') return sc.left <= 0 ? this.play(sc, members) : []
    const out: Command[] = []
    // Scene beats within play.
    if (sc.kind === 'drive') {
      const m = members[0]
      if (m.left <= 0) {
        const leg = sc.legs.shift()
        if (leg === undefined) return this.endScene()
        out.push(this.walkTo(m, leg, 'drive', DRIVE_PX_PER_S))
      }
    }
    if (sc.kind === 'parachute') {
      const m = members[0]
      if (m.left <= 0 && m.activity === 'parachute') return this.endScene()
    }
    if (sc.kind === 'fish' && !sc.landed && sc.left < 15_000) {
      sc.landed = true
      const m = members[0]
      this.become(m, 'fishcaught', 'love', 1e12)
      this.lastSaid = { text: 'Got one!', kind: 'speech' }
      m.sinceSpoke = 0
      out.push(this.withSaid(m))
    }
    if (sc.left <= 0) return [...out, ...this.endScene()]
    return out
  }

  /** Picks a scene the pets out can do, the room for it, and walks the cast into place. */
  private startScene(): Command[] {
    const free = [...this.minds.values()].filter((m) => this.awake(m) && !this.afterWalk.has(m.pet.id))
    if (free.length === 0) return []
    const kinds: [SceneKind, number][] = [
      ['catch', free.length >= 2 ? 1.2 : 0],
      ['tennis', free.length >= 2 ? 1 : 0],
      ['share', free.length >= 2 ? 0.8 : 0],
      ['picnic', free.length >= 2 ? 1 : 0],
      ['fish', 1],
      ['tree', 1],
      ['drive', 0.9],
      ['parachute', this.rail > 200 ? 1 : 0],
    ]
    if (this.sceneKinds !== null) for (const k of kinds) if (!this.sceneKinds.includes(k[0])) k[1] = 0
    const total = kinds.reduce((a, [, w]) => a + w, 0)
    if (total === 0) return []
    let r = this.rand() * total
    let kind: SceneKind = 'tree'
    for (const [k, w] of kinds) { r -= w; if (r <= 0) { kind = k; break } }
    const shuffled = [...free].sort(() => this.rand() - 0.5)
    const size = Math.max(...free.map((m) => m.pet.size))
    const wants = kind === 'picnic' ? Math.min(3, free.length) : ['catch', 'tennis', 'share'].includes(kind) ? 2 : kind === 'tree' && free.length >= 2 && this.rand() < 0.6 ? 2 : 1
    const cast = shuffled.slice(0, wants)
    // Where the cast stands, relative to the scene's middle, in pixels along the bar.
    const spots: Record<SceneKind, number[]> = {
      catch: [-1.5 * size, 1.5 * size],
      tennis: [-2.6 * size, 2.6 * size],
      share: [-0.55 * size, 0.55 * size],
      picnic: [-0.8 * size, 0, 0.8 * size].slice(0, cast.length),
      fish: [-0.7 * size],
      tree: cast.length === 2 ? [-0.45 * size, 0.55 * size] : [-0.1 * size],
      drive: [0],
      parachute: [0],
    }
    const span = Math.max(...spots[kind].map(Math.abs)) + size
    if (kind !== 'parachute' && this.bar < span * 2 + 40) return []
    // Somewhere clear of everyone not taking part (a pet asleep there would not move for it).
    const bystanders = [...this.minds.values()].filter((m) => !cast.includes(m))
    const clear = (c: number): boolean => kind === 'drive' || bystanders.every((o) => {
      const s = this.toS(o.pet.place)
      // Asleep, it would not move out of the way: keep clear of it altogether. Awake, it will.
      if (o.activity === 'sleep' || o.forcedSleep || o.activity === 'held') return s + o.pet.size / 2 <= c - span || s - o.pet.size / 2 >= c + span
      return spots[kind].every((d, i) => Math.abs(s - (c + d)) >= this.gap(cast[i], o))
    })
    let centre = kind === 'parachute' ? -(HOP_PX + this.rail) : Number.NaN
    // Near where the cast already is, so the scene starts soon; further afield if that is taken.
    const home = cast.reduce((a, m) => a + Math.max(0, this.toS(m.pet.place)), 0) / cast.length
    for (let i = 0; i < 30 && Number.isNaN(centre); i++) {
      const reach = 80 + i * 40
      const c = Math.min(this.bar - span, Math.max(span, home + this.between(-reach, reach)))
      if (clear(c)) centre = c
    }
    if (Number.isNaN(centre)) return []
    const key = `scene-${String(++this.sceneCount)}`
    // Parachuting and driving move about; the rest keep their stretch of the bar to themselves.
    const zone: [number, number] = kind === 'parachute' || kind === 'drive' ? [Number.NaN, Number.NaN] : [centre - span, centre + span]
    this.scene = { kind, members: cast.map((m) => m.pet.id), phase: 'gather', left: 0, centre, scenery: [], legs: [], landed: false, zone }
    const out: Command[] = []
    let longest = 0
    cast.forEach((m, i) => {
      this.afterWalk.delete(m.pet.id)
      const target = kind === 'parachute' ? centre : centre + spots[kind][i]
      // The giver fetches a snack on the way over.
      const walk = this.walkTo(m, target, kind === 'share' && i === 0 ? 'carry' : kind === 'parachute' ? 'climb' : 'walk', kind === 'parachute' ? CLIMB_PX_PER_S : WALK_PX_PER_S * 1.6)
      longest = Math.max(longest, walk.ms)
      out.push(walk)
    })
    this.scene.left = longest + 500
    // Scenery comes out as they set off, so they are seen walking to it.
    const at = this.fromS(centre)
    if (kind === 'fish') this.show({ key: `${key}-pond`, kind: 'pond', show: true, at: this.fromS(centre + 0.35 * size) })
    if (kind === 'tree') this.show({ key: `${key}-tree`, kind: 'tree', show: true, at })
    if (kind === 'picnic') this.show({ key: `${key}-picnic`, kind: 'picnic', show: true, at })
    return out
  }

  private show(s: Scenery): void {
    this.scene?.scenery.push(s)
    this.sceneryOut.push(s)
  }

  private play(sc: Scene, members: PetMind[]): Command[] {
    sc.phase = 'play'
    sc.left = this.between(...SCENE_PLAY_MS)
    const out: Command[] = []
    const face = (a: PetMind, b: PetMind): void => { a.facing = this.toS(a.pet.place) < this.toS(b.pet.place) ? 'right' : 'left' }
    switch (sc.kind) {
      case 'catch':
      case 'tennis': {
        const [a, b] = members
        face(a, b)
        face(b, a)
        const period = sc.kind === 'tennis' ? 1400 : 1800
        for (const m of members) this.become(m, sc.kind, 'happy', 1e12)
        this.show({ key: `scene-${String(this.sceneCount)}-ball`, kind: 'ball', show: true, at: a.pet.place, to: b.pet.place, ms: period, style: sc.kind })
        break
      }
      case 'share': {
        const [giver, taker] = members
        face(giver, taker)
        face(taker, giver)
        for (const m of members) this.become(m, 'eat', 'love', 1e12)
        this.lastSaid = null
        this.speak(giver, 'greet', 'speech', EVENT_SPEECH_GAP_MS)
        out.push(this.withSaid(giver), this.command(taker))
        return out
      }
      case 'picnic':
        members.forEach((m, i) => { this.become(m, i % 2 === 0 ? 'eat' : 'drink', 'love', 1e12) })
        break
      case 'fish':
        members[0].facing = 'right'
        this.become(members[0], 'fish', 'focused', 1e12)
        break
      case 'tree':
        for (const m of members) this.become(m, 'read', 'focused', 1e12)
        break
      case 'drive': {
        const m = members[0]
        // A lap: to one end, the other, and back to about where it started.
        const here = this.toS(m.pet.place)
        sc.legs = [this.bar * this.between(0.75, 0.95), this.bar * this.between(0.05, 0.2), here]
        sc.left = 1e12
        const first = sc.legs.shift()!
        out.push(this.walkTo(m, first, 'drive', DRIVE_PX_PER_S))
        return out
      }
      case 'parachute': {
        const m = members[0]
        // Off the top of the rail, floating down to its foot.
        out.push(this.walkTo(m, -HOP_PX, 'parachute', PARACHUTE_PX_PER_S))
        sc.left = 1e12
        return out
      }
    }
    for (const m of members) out.push(this.command(m))
    return out
  }

  private endScene(): Command[] {
    const sc = this.scene
    if (sc === null) return []
    this.scene = null
    for (const s of sc.scenery) this.sceneryOut.push({ ...s, show: false })
    const out: Command[] = []
    for (const id of sc.members) {
      const m = this.minds.get(id)
      if (m === undefined || m.activity === 'held') continue
      this.become(m, 'stretch', 'happy', 1500)
      out.push(this.command(m))
    }
    return out
  }

  // -- personal space: pets stand side by side, never one in front of another

  /** How far apart two pets' middles must be: their bodies, which fill most of their boxes. */
  private gap(a: PetMind, b: PetMind): number {
    return ((a.pet.size + b.pet.size) / 2) * 0.95
  }

  /**
   * Whether this pet is standing on another and should be the one to move. The one that stays:
   * a pet in a scene (placed there on purpose), then one being held or just dropped, then one
   * asleep; between two alike, the one with the smaller id — so exactly one of them moves.
   */
  private crowding(m: PetMind): boolean {
    if (MOVING.has(m.activity) || m.activity === 'sleep' || this.afterWalk.has(m.pet.id)) return false
    const here = this.toS(m.pet.place)
    const zone = this.scene?.zone
    if (zone !== undefined && !this.inScene(m) && !Number.isNaN(zone[0]) && m.activity !== 'held' && m.sinceDropped > 8000 && here + m.pet.size / 2 > zone[0] && here - m.pet.size / 2 < zone[1]) return true
    const rank = (x: PetMind): number => (this.inScene(x) ? 3 : x.activity === 'held' || x.sinceDropped < 8000 ? 2 : x.activity === 'sleep' || x.forcedSleep ? 1 : 0)
    for (const o of this.minds.values()) {
      if (o === m || Math.abs(this.toS(o.pet.place) - here) >= this.gap(m, o) - 1) continue
      const mine = rank(m)
      const theirs = rank(o)
      if (mine < theirs || (mine === theirs && m.pet.id > o.pet.id)) return true
    }
    return false
  }

  /** Steps aside to the nearest free spot — or, under reduced motion, is simply there. */
  private makeRoom(m: PetMind): Command {
    const target = this.freeSpot(m, this.toS(m.pet.place))
    if (!this.reducedMotion) return this.walkTo(m, target, 'walk', WALK_PX_PER_S * 1.5)
    const to = this.fromS(target)
    m.pet.place = to
    this.become(m, 'idle', 'happy', this.between(3000, 8000))
    return this.command(m, to, 0)
  }

  /** The nearest spot to `target` with room for this pet beside every other (where they are headed). */
  private freeSpot(m: PetMind, target: number, lo = this.minS()): number {
    const hi = this.bar
    const clamp = (v: number): number => Math.min(hi, Math.max(lo, v))
    const zone = this.scene !== null && !this.inScene(m) ? this.scene.zone : null
    const half = m.pet.size / 2
    const outside = (v: number): boolean => zone === null || Number.isNaN(zone[0]) || v + half <= zone[0] || v - half >= zone[1]
    const fits = (v: number): boolean => outside(v) && [...this.minds.values()].every((o) => o === m || Math.abs(this.toS(o.pet.place) - v) >= this.gap(m, o) - 0.5)
    const start = clamp(target)
    if (fits(start)) return start
    // Look either side, a few pixels at a time, nearest first.
    for (let d = 4; d <= hi - lo; d += 4) {
      if (fits(clamp(start + d))) return clamp(start + d)
      if (fits(clamp(start - d))) return clamp(start - d)
    }
    return start
  }

  private walkTo(m: PetMind, target: number, activity: Activity, pxPerS: number): Command {
    const here = this.toS(m.pet.place)
    const to = this.fromS(target)
    const ms = Math.max(400, Math.round((Math.abs(target - here) / pxPerS) * 1000))
    // Facing follows the bar's direction; up and down the rail it faces the window.
    m.facing = target === here ? m.facing : target > here ? 'right' : 'left'
    m.pet.place = to
    this.become(m, activity, activity === 'run' || activity === 'skate' ? 'love' : activity === 'parachute' ? 'surprised' : 'happy', ms)
    return this.command(m, to, ms)
  }
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}
