import type { ResidentStatus, ResidentTurnOrigin } from '@shared/domain/residents'
import { fireAndForget } from '../log/fireAndForget'
import type { Resident } from './residentStatus'

/** A resident as another one sees it. */
export interface ResidentName {
  id: string
  name: string
  kindId: string
  state: ResidentStatus['state']
  setupNeeded: string | null
}

/** The most an `ask`'s label quotes of the question. */
const ASK_LABEL_QUOTE = 80
const NOTE_LABEL_MAX = 120
const TEXT_MAX = 8000

/** Throws, in words a person can read, unless the resident is enabled and set up. */
function requireWorking(r: Resident): void {
  if (!r.config.enabled) throw new Error(`${r.config.name} is not enabled`)
  const missing = r.kind.setup(r.config)
  if (missing !== null) throw new Error(`${r.config.name} is not set up: ${missing}`)
}

/** The enabled resident `toName` names (ignoring case), never `from` itself; an unknown or ambiguous name throws and lists the names. */
function residentNamed(all: Resident[], from: Resident, toName: string): Resident {
  const enabled = all.filter((r) => r.config.enabled)
  const wanted = toName.trim().toLowerCase()
  const found = enabled.filter((r) => r.config.name.trim().toLowerCase() === wanted)
  const listed = enabled.map((r) => r.config.name).join(', ') || 'none'
  const [target] = found
  if (target === undefined) throw new Error(`No resident is named "${toName}". Residents: ${listed}`)
  if (found.length > 1) throw new Error(`More than one resident is named "${toName}". Residents: ${listed}`)
  if (target === from) throw new Error(`${from.config.name} cannot ask itself`)
  return target
}

export interface OutsideDeps {
  require: (id: string) => Resident
  all: () => Resident[]
  /** Orders this turn against actions, as `send` does. */
  nextSeq: () => number
  stateOf: (r: Resident) => ResidentStatus['state']
  now: () => number
  /** A status or hold changed; the service re-evaluates its timers. */
  reconcile: () => void
  statusChanged: () => void
  /** Runs `r`'s cycle as a turn with the given origin. */
  cycle: (r: Resident, origin: ResidentTurnOrigin) => void
}

/**
 * What something other than the popup may do to a resident: send it a message, give it a note,
 * keep it awake, and let one resident ask or check another by name. Nothing here names a kind.
 */
export class ResidentOutside {
  constructor(private readonly deps: OutsideDeps) {}

  /** claude is sent `text`; the chat shows `shown` as the person's, marked `via`. Not held back by duty, usage or a running turn. */
  sendFrom(id: string, o: { text: string; shown: string; via: 'slack' }): void {
    const r = this.deps.require(id)
    requireWorking(r)
    if (o.text.trim() === '' || o.text.length > TEXT_MAX || o.shown.trim() === '') throw new Error(`A message is 1 to ${String(TEXT_MAX)} characters`)
    r.turnSeq = this.deps.nextSeq()
    fireAndForget(r.chat.send(o.text, null, { shown: o.shown, via: o.via, origin: o.via }), 'residents')
  }

  /** claude is sent `text`; the chat shows `label` as a chip. */
  note(id: string, o: { text: string; label: string }): void {
    const r = this.deps.require(id)
    requireWorking(r)
    if (o.text.trim() === '' || o.text.length > TEXT_MAX) throw new Error(`A note is 1 to ${String(TEXT_MAX)} characters`)
    if (o.label.length < 1 || o.label.length > NOTE_LABEL_MAX) throw new Error(`A note's label is 1 to ${String(NOTE_LABEL_MAX)} characters`)
    r.turnSeq = this.deps.nextSeq()
    fireAndForget(r.chat.send(o.text, null, { shown: o.label, note: true, origin: 'note' }), 'residents')
  }

  /** Keeps the resident's claude running off duty until the returned function is called; the idle minutes then start again. */
  keepAwake(id: string, reason: string): () => void {
    const r = this.deps.require(id)
    const hold = { reason }
    r.holds.push(hold)
    this.deps.statusChanged()
    return () => {
      const at = r.holds.indexOf(hold)
      if (at < 0) return
      r.holds.splice(at, 1)
      if (r.holds.length === 0) { r.chat.lastActive = this.deps.now(); this.deps.reconcile() }
    }
  }

  /** The enabled residents. */
  names(): ResidentName[] {
    return this.deps.all().filter((r) => r.config.enabled)
      .map((r) => ({ id: r.config.id, name: r.config.name, kindId: r.config.kind, state: this.deps.stateOf(r), setupNeeded: r.kind.setup(r.config) }))
  }

  /** Sends `text` to the resident called `toName` as a note; its answer is its next turn end. Does not wait. */
  ask(fromId: string, toName: string, text: string): { id: string; name: string } {
    const from = this.deps.require(fromId)
    const to = residentNamed(this.deps.all(), from, toName)
    this.note(to.config.id, { text, label: `${from.config.name} asked: ${text.trim().slice(0, ASK_LABEL_QUOTE)}` })
    return { id: to.config.id, name: to.config.name }
  }

  /** Runs the other resident's cycle now, on duty or not. */
  check(fromId: string, toName: string): { id: string; name: string } {
    const to = residentNamed(this.deps.all(), this.deps.require(fromId), toName)
    if (to.kind.cycle === undefined) throw new Error(`${to.config.name} has nothing to check`)
    requireWorking(to)
    this.deps.cycle(to, 'cycle')
    return { id: to.config.id, name: to.config.name }
  }
}
