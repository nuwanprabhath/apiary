import { type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveTabPayload } from '@shared/domain/tabs'
import type { Activity, BrainPet, Face, Scenery } from '@shared/pets/brain'
import { habitatLengths, nearestPlace, normalisePlace, placeToPoint, type Habitat } from '@shared/pets/habitat'
import type { ChatTurn, VoiceContext } from '@shared/pets/prompt'
import { PET_SIZE_STEPS, type PetPlace, type PetRecord, type PetsState } from '@shared/pets/state'
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu'
import { BrainClient } from './brainClient'
import type { FromBrain } from './petBrain.worker'
import { SceneryLayer } from './SceneryLayer'
import { PetChat } from './PetChat'
import { PetSprite } from './PetSprite'
import { useHabitat } from './useHabitat'

interface Props {
  /** The pets as main has them (`usePets`); null until known. */
  state: PetsState | null
  sidebarHidden: boolean
  /** Every window's tabs and what each is doing — what the pets react to. */
  tabs: ActiveTabPayload[]
  /** A tab's session title, for the pets' hourly lines; null when it has none. */
  titleOf: (key: string) => string | null
  onOpenSettings: (section: string) => void
}

/** Whether any pet is out — the status bar stays drawn for them to stand on. */
export function petsOut(state: PetsState | null): boolean {
  return state?.enabled === true && state.pets.some((p) => p.active)
}

/**
 * The pets, when they are on and at least one is out. Mounts nothing otherwise — no layer, no
 * worker, no timers.
 */
export function PetLayer(props: Props): JSX.Element | null {
  const { state } = props
  const pets = useMemo(() => (state?.enabled === true ? state.pets.filter((p) => p.active) : []), [state])
  const habitat = useHabitat(pets.length > 0, props.sidebarHidden)
  if (pets.length === 0 || habitat === null) return null
  return <PetWorld {...props} pets={pets} habitat={habitat} />
}

interface Pose {
  activity: Activity
  face: Face
  facing: 'left' | 'right'
  place: PetPlace
  /** The walk under way, in ms; 0 once there. */
  ms: number
  say: { text: string; kind: 'speech' | 'thought' } | null
}

const SAY_MS = { speech: 5500, thought: 4500 }
/** How often to ask whether a pet's lines are due a refresh; main decides whether they are. */
const VOICE_CHECK_MS = 10 * 60_000
const VOICE_FIRST_MS = 30_000
const DRAG_THRESHOLD_PX = 4
/** How often to ask what the working sessions are doing, while any is. */
const ACTIONS_EVERY_MS = 10_000

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

function PetWorld({ pets, habitat, tabs, titleOf, onOpenSettings }: Props & { pets: PetRecord[]; habitat: Habitat }): JSX.Element {
  const [poses, setPoses] = useState<Record<string, Pose>>({})
  const [held, setHeld] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [chat, setChat] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, ChatTurn[]>>({})
  const [asleep, setAsleep] = useState<ReadonlySet<string>>(() => new Set())
  const [scenery, setScenery] = useState<Record<string, { item: Scenery; leaving: boolean }>>({})
  const brain = useRef<BrainClient | null>(null)
  /** The latest action of each working session, for remarks (shared/pets/actions.ts). */
  const actions = useRef(new Map<string, string>())
  const posesRef = useRef(poses)
  posesRef.current = poses
  const timers = useRef(new Set<number>())

  const later = useCallback((fn: () => void, ms: number): void => {
    const t = window.setTimeout(() => { timers.current.delete(t); fn() }, ms)
    timers.current.add(t)
  }, [])

  const say = useCallback((id: string, text: string, kind: 'speech' | 'thought'): void => {
    const said = { text, kind }
    setPoses((p) => (p[id] !== undefined ? { ...p, [id]: { ...p[id], say: said } } : p))
    later(() => { setPoses((p) => (p[id]?.say === said ? { ...p, [id]: { ...p[id], say: null } } : p)) }, SAY_MS[kind])
  }, [later])

  /** A pet has gone to look at Claude's work: ask its model what it makes of it. */
  const remark = useCallback((id: string): void => {
    const action = [...actions.current.values()][0]
    if (action === undefined) return
    void window.apiary.petComment(id, action).then((text) => { if (text !== null) say(id, text, 'speech') }).catch(() => {})
  }, [say])

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
      // Scenery fades away, then goes.
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

  // What Claude is doing, from every window's tabs: the brain hears the counts, where in this
  // window a session works, and which one just finished — to send a pet to point at it.
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
  }, [tabs])

  // While anything works, what it is doing — tool and label only — for the pets' remarks.
  const working = claudeCounts(tabs).working > 0
  const runningKeys = useRef<string[]>([])
  runningKeys.current = tabs.filter((t) => t.status === 'running').map((t) => t.key)
  useEffect(() => {
    if (!working) { actions.current.clear(); return }
    const poll = (): void => {
      void window.apiary.petClaudeActions(runningKeys.current).then((list) => {
        actions.current = new Map(list.map((a) => [a.key, a.action]))
      }).catch(() => {})
    }
    poll()
    const every = window.setInterval(poll, ACTIONS_EVERY_MS)
    return () => { window.clearInterval(every) }
  }, [working])

  // Fresh lines now and then; main decides whether a pet is due (at most hourly).
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
        try { await window.apiary.petVoice(p.id, ctx) } catch { /* the next check tries again */ }
      }
    }
    const first = window.setTimeout(() => { void ask() }, VOICE_FIRST_MS)
    const every = window.setInterval(() => { void ask() }, VOICE_CHECK_MS)
    return () => { window.clearTimeout(first); window.clearInterval(every) }
  }, [])

  // -- dragging, clicking and the menu

  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; el: HTMLElement } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord): void => {
    const d = drag.current
    if (d?.id !== pet.id) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX) return
      d.moved = true
      setHeld(pet.id)
      setChat(null)
      brain.current?.send({ kind: 'held', id: pet.id })
    }
    // Straight onto the element while held: no React render per pointer move.
    d.el.style.transitionDuration = '0ms'
    d.el.style.transform = `translate(${String(e.clientX - pet.size / 2)}px, ${String(e.clientY - pet.size / 2)}px)`
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord): void => {
    const d = drag.current
    drag.current = null
    if (d?.id !== pet.id) return
    if (!d.moved) {
      setChat(pet.id)
      brain.current?.send({ kind: 'poke', id: pet.id })
      return
    }
    const place = nearestPlace(habitat, { x: e.clientX, y: e.clientY + pet.size / 2 }, pet.size)
    const pt = placeToPoint(habitat, place, pet.size)
    d.el.style.transform = `translate(${String(pt.x - pet.size / 2)}px, ${String(pt.y - pet.size)}px)`
    setHeld(null)
    setPoses((p) => ({ ...p, [pet.id]: { ...(p[pet.id]), place, ms: 0 } }))
    brain.current?.send({ kind: 'dropped', id: pet.id, place })
    void window.apiary.petUpdate(pet.id, { place }).catch(() => {})
  }

  const menuPet = menu !== null ? pets.find((p) => p.id === menu.id) : undefined
  const menuItems: ContextMenuItem[] = menuPet === undefined ? [] : [
    { id: 'chat', label: `Chat with ${menuPet.spec.name}…`, run: () => { setChat(menuPet.id) } },
    ...PET_SIZE_STEPS.map((step, i) => ({
      id: `size-${String(step.size)}`, label: step.label, separator: i === 0, checked: menuPet.size === step.size,
      run: () => { void window.apiary.petUpdate(menuPet.id, { size: step.size }).catch(() => {}) },
    })),
    asleep.has(menuPet.id)
      ? { id: 'wake', label: 'Wake up', separator: true, run: () => { setAsleep((s) => without(s, menuPet.id)); brain.current?.send({ kind: 'sleep', id: menuPet.id, on: false }) } }
      : { id: 'sleep', label: 'Go to sleep', separator: true, run: () => { setAsleep((s) => new Set(s).add(menuPet.id)); brain.current?.send({ kind: 'sleep', id: menuPet.id, on: true }) } },
    { id: 'hide', label: `Put ${menuPet.spec.name} away`, run: () => { void window.apiary.petUpdate(menuPet.id, { active: false }).catch(() => {}) } },
    { id: 'settings', label: 'Pet settings…', separator: true, run: () => { onOpenSettings('pets') } },
  ]

  const chatPet = chat !== null ? pets.find((p) => p.id === chat) : undefined
  const chatPose = chatPet !== undefined ? poses[chatPet.id] as Pose | undefined : undefined

  return (
    <div className="pet-layer" data-testid="pet-layer">
      <SceneryLayer habitat={habitat} items={scenery} size={pets.reduce((a, p) => a + p.size, 0) / pets.length} />
      {pets.map((pet) => {
        const pose = poses[pet.id] as Pose | undefined
        if (pose === undefined) return null
        const place = normalisePlace(habitat, pose.place, 0)
        const pt = placeToPoint(habitat, place, pet.size)
        const align = pt.x < 120 ? 'start' : pt.x > window.innerWidth - 120 ? 'end' : 'middle'
        const style = {
          '--pet-size': `${String(pet.size)}px`,
          transform: `translate(${String(pt.x - pet.size / 2)}px, ${String(pt.y - pet.size)}px)`,
          transitionDuration: `${String(pose.ms)}ms`,
        } as CSSProperties
        return (
          <div
            key={pet.id}
            className="pet"
            data-testid="pet"
            data-pet-id={pet.id}
            data-held={held === pet.id}
            data-region={place.region}
            role="button"
            aria-label={`${pet.spec.name} — click to chat, drag to move, right-click for more`}
            title={pet.spec.name}
            style={style}
            onPointerDown={(e) => { onPointerDown(e, pet.id) }}
            onPointerMove={(e) => { onPointerMove(e, pet) }}
            onPointerUp={(e) => { onPointerUp(e, pet) }}
            onPointerCancel={() => { drag.current = null; setHeld(null) }}
            onContextMenu={(e) => { e.preventDefault(); setChat(null); setMenu({ id: pet.id, x: e.clientX, y: e.clientY }) }}
          >
            <PetSprite spec={pet.spec} size={pet.size} activity={held === pet.id ? 'held' : pose.activity} face={held === pet.id ? 'surprised' : pose.face} facing={pose.facing} onRail={place.region === 'rail'} />
            {pose.say !== null && held !== pet.id && (
              <div className="pet-bubble" data-testid="pet-bubble" data-kind={pose.say.kind} data-align={align}>{pose.say.text}</div>
            )}
          </div>
        )
      })}
      <ContextMenu items={menuItems} position={menu !== null ? { x: menu.x, y: menu.y } : null} onClose={() => { setMenu(null) }} testId="pet-menu" />
      {chatPet !== undefined && chatPose !== undefined && (
        <PetChat
          pet={chatPet}
          anchor={placeToPoint(habitat, normalisePlace(habitat, chatPose.place, 0), chatPet.size)}
          history={histories[chatPet.id] ?? []}
          onSaid={(turns) => { setHistories((h) => ({ ...h, [chatPet.id]: [...(h[chatPet.id] ?? []), ...turns].slice(-20) })) }}
          onClose={() => { setChat(null) }}
        />
      )}
    </div>
  )
}

function without<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set)
  next.delete(item)
  return next
}
