import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActiveTabPayload } from '@shared/domain/tabs'
import type { Activity, BrainPet, Face, Scenery } from '@shared/pets/brain'
import { habitatLengths, nearestPlace, normalisePlace, type Habitat } from '@shared/pets/habitat'
import type { VoiceContext } from '@shared/pets/prompt'
import type { PetPlace, PetRecord } from '@shared/pets/state'
import { askPetVoice, latestClaudeAction, onPetVoiceCheck, petRemark, watchClaudeActions } from '../../state/petsStore'
import { BrainClient } from './brainClient'
import type { FromBrain } from './petBrain.worker'

export interface Pose {
  activity: Activity
  face: Face
  facing: 'left' | 'right'
  place: PetPlace
  /** The walk under way, in ms; 0 once there. */
  ms: number
  say: { text: string; kind: 'speech' | 'thought' } | null
}

export type SceneryState = Record<string, { item: Scenery; leaving: boolean }>

const SAY_MS = { speech: 5500, thought: 4500 }

/** The spot on the bar under a session's pane in this window, or null when it is not in this one. */
function underPane(h: Habitat, key: string): PetPlace | null {
  const pane = document.querySelector(`[data-testid="session-column"][data-session-key="${CSS.escape(key)}"]`)
  if (pane === null) return null
  const r = pane.getBoundingClientRect()
  if (r.width === 0) return null
  const place = nearestPlace(h, { x: r.left + r.width / 2, y: h.bar.y + h.bar.height }, 64)
  return place.region === 'bar' ? place : null
}

/** Where a pet with no place yet starts: spread along the bar so new pets do not stack. */
const spread = (i: number): number => 0.15 + ((i * 0.27) % 0.7)

function claudeCounts(tabs: ActiveTabPayload[]): { working: number; waiting: number; statuses: Map<string, string> } {
  const statuses = new Map<string, string>()
  for (const t of tabs) statuses.set(t.key, t.status)
  let working = 0
  let waiting = 0
  for (const s of statuses.values()) {
    if (s === 'running') working++
    else if (s === 'waiting') waiting++
  }
  return { working, waiting, statuses }
}

/** Everything between the pets and their brain worker. Moving a pet by hand is `usePetInteraction`. */
export function usePetBrain(
  pets: PetRecord[], habitat: Habitat, tabs: ActiveTabPayload[], titleOf: (key: string) => string | null,
) {
  const [poses, setPoses] = useState<Record<string, Pose>>({})
  const [scenery, setScenery] = useState<SceneryState>({})
  const brain = useRef<BrainClient | null>(null)
  const posesRef = useRef(poses)
  posesRef.current = poses
  const timers = useRef(new Set<number>())

  const later = useCallback((fn: () => void, ms: number): void => {
    const t = window.setTimeout(() => { timers.current.delete(t); fn() }, ms)
    timers.current.add(t)
  }, [])

  /** A pet has gone to look at Claude's work: ask its model what it makes of it. */
  const remark = useCallback((id: string): void => {
    const action = latestClaudeAction()
    if (action === undefined) return
    void petRemark(id, action).then((text) => {
      if (text === null) return
      const said = { text, kind: 'speech' as const }
      setPoses((p) => (p[id] !== undefined ? { ...p, [id]: { ...p[id], say: said } } : p))
      later(() => { setPoses((p) => (p[id]?.say === said ? { ...p, [id]: { ...p[id], say: null } } : p)) }, SAY_MS.speech)
    })
  }, [later])

  const apply = useCallback(({ commands: cmds, scenery: items }: FromBrain): void => {
    setPoses((prev) => {
      const next = { ...prev }
      for (const c of cmds) {
        const cur = prev[c.id] as Pose | undefined
        const place = c.to ?? cur?.place
        if (place === undefined) continue
        next[c.id] = {
          activity: c.activity, face: c.face, facing: c.facing, place,
          ms: c.to !== undefined ? c.ms : (cur?.ms ?? 0),
          say: c.say ?? cur?.say ?? null,
        }
      }
      return next
    })
    for (const c of cmds) {
      if (c.to !== undefined) later(() => { setPoses((p) => (p[c.id]?.place === c.to ? { ...p, [c.id]: { ...p[c.id], ms: 0 } } : p)) }, c.ms)
      const said = c.say
      if (said !== undefined) {
        later(() => { setPoses((p) => (p[c.id]?.say === said ? { ...p, [c.id]: { ...p[c.id], say: null } } : p)) }, SAY_MS[said.kind])
      }
      if (c.ask === 'comment') remark(c.id)
    }
    if (items.length > 0) {
      setScenery((prev) => {
        const next = { ...prev }
        for (const item of items) {
          if (item.show) next[item.key] = { item, leaving: false }
          else if (next[item.key] !== undefined) next[item.key] = { ...next[item.key], leaving: true }
        }
        return next
      })
      for (const item of items) {
        if (!item.show) later(() => { setScenery((p) => { const { [item.key]: _gone, ...rest } = p; return rest }) }, 700)
      }
    }
  }, [later, remark])

  // The brain: one worker for every pet, paused while the window is hidden.
  useEffect(() => {
    const client = new BrainClient(apply)
    brain.current = client
    const visibility = (): void => { if (document.visibilityState === 'hidden') client.pause(); else client.resume() }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = (): void => { client.send({ kind: 'reducedMotion', on: motion.matches }) }
    onMotion()
    visibility()
    document.addEventListener('visibilitychange', visibility)
    motion.addEventListener('change', onMotion)
    const pending = timers.current
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      motion.removeEventListener('change', onMotion)
      for (const t of pending) window.clearTimeout(t)
      pending.clear()
      client.dispose()
      brain.current = null
    }
  }, [apply])

  // Which pets, and where they may walk. A pet the brain already knows keeps its own place.
  useEffect(() => {
    const client = brain.current
    if (client === null) return
    const lengths = habitatLengths(habitat, 28)
    client.send({ kind: 'habitat', rail: lengths.rail, bar: lengths.bar })
    const list: BrainPet[] = pets.map((p, i) => ({
      id: p.id, traits: p.spec.traits, lines: p.spec.lines, size: p.size,
      place: normalisePlace(habitat, posesRef.current[p.id]?.place ?? p.place, spread(i)),
    }))
    setPoses((prev) => {
      const next: Record<string, Pose> = {}
      for (const bp of list) {
        const cur = prev[bp.id] as Pose | undefined
        next[bp.id] = cur !== undefined ? { ...cur, place: normalisePlace(habitat, cur.place, 0) } : { activity: 'idle', face: 'happy', facing: 'right', place: bp.place, ms: 0, say: null }
      }
      return next
    })
    client.send({ kind: 'pets', pets: list })
  }, [pets, habitat])

  useClaudeFeed(brain, habitat, tabs)
  useVoiceChecks(pets, tabs, titleOf)

  return { poses, setPoses, scenery, brain }
}

/**
 * What Claude is doing, from every window's tabs: the brain hears the counts, where in this
 * window a session works, and which one just finished — to send a pet to point at it.
 */
function useClaudeFeed(
  brain: { current: BrainClient | null }, habitat: Habitat, tabs: ActiveTabPayload[],
): void {
  const habitatRef = useRef(habitat)
  habitatRef.current = habitat
  const lastClaude = useRef<{ working: number; waiting: number; statuses: Map<string, string> }>({ working: 0, waiting: 0, statuses: new Map() })
  const lastWorkingAt = useRef<string>('null')
  useEffect(() => {
    const now = claudeCounts(tabs)
    const before = lastClaude.current
    const finished = [...now.statuses].filter(([key, status]) => before.statuses.get(key) === 'running' && status === 'idle').map(([key]) => key)
    lastClaude.current = now
    const client = brain.current
    if (client === null) return
    const running = [...now.statuses].filter(([, s]) => s === 'running').map(([key]) => key)
    const workingAt = running.map((k) => underPane(habitatRef.current, k)).find((p) => p !== null) ?? null
    if (JSON.stringify(workingAt) !== lastWorkingAt.current) {
      lastWorkingAt.current = JSON.stringify(workingAt)
      client.send({ kind: 'workingAt', at: workingAt })
    }
    if (now.working !== before.working || now.waiting !== before.waiting || finished.length > 0) {
      client.send({ kind: 'claude', working: now.working, waiting: now.waiting, finishedNow: finished.length > 0 })
    }
    const done = finished.map((k) => underPane(habitatRef.current, k)).find((p) => p !== null)
    if (done !== undefined) client.send({ kind: 'pointAt', at: done })
  }, [tabs, brain])

  // What Claude is doing, tool and label only, for the pets' remarks: kept current by main's pushes
  // (state/petsStore.ts), read when a pet remarks.
  useEffect(() => watchClaudeActions(), [])

}

/** Fresh lines now and then; main decides whether a pet is due (at most hourly). */
function useVoiceChecks(pets: PetRecord[], tabs: ActiveTabPayload[], titleOf: (key: string) => string | null): void {
  const voiceInputs = useRef({ pets, tabs, titleOf })
  voiceInputs.current = { pets, tabs, titleOf }
  useEffect(() => {
    const ask = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return
      const { pets: list, tabs: open, titleOf: title } = voiceInputs.current
      const { working, waiting } = claudeCounts(open)
      const titles = [...new Set(open.map((t) => title(t.key)).filter((t): t is string => t !== null && t !== ''))].slice(0, 8)
      const ctx: VoiceContext = { working, waiting, finished: 0, titles, hour: new Date().getHours() }
      for (const p of list) {
        if (Date.now() - p.voicedAt < 60 * 60_000) continue
        await askPetVoice(p.id, ctx)
      }
    }
    return onPetVoiceCheck(() => { void ask() })
  }, [])
}
