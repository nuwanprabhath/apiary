import { isRecord } from '@shared/guards'

export interface SlackTask {
  /** The task's id: the ts of the top-level message that started it. */
  thread: string
  text: string
  startedAt: number
  state: 'open' | 'done'
  /** Session ids (as stringList) being watched for it. */
  sessions: string[]
  /** Resident ids working for it. */
  residents: string[]
  /** Sessions whose permission prompts are answered "allow" without asking, until it is done. */
  autoAllow: string[]
  /** The ts of the newest reply read in its thread. */
  lastReplyTs: string | null
}

const DAY = 24 * 60 * 60 * 1000
const DONE_KEPT_MS = 7 * DAY
const DONE_KEPT_MAX = 200

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** One saved task, or null when it is damaged. */
export function parseTask(raw: unknown): SlackTask | null {
  if (!isRecord(raw) || typeof raw.thread !== 'string' || raw.thread === '' || typeof raw.text !== 'string') return null
  if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) return null
  if (raw.state !== 'open' && raw.state !== 'done') return null
  return {
    thread: raw.thread, text: raw.text, startedAt: raw.startedAt, state: raw.state,
    sessions: stringList(raw.sessions), residents: stringList(raw.residents), autoAllow: stringList(raw.autoAllow),
    lastReplyTs: typeof raw.lastReplyTs === 'string' ? raw.lastReplyTs : null,
  }
}

const add = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id])

/** The tasks by thread. Every change is handed to `persist` at once. */
export class SlackTasks {
  private readonly tasks = new Map<string, SlackTask>()
  private readonly listeners = new Set<() => void>()

  constructor(initial: SlackTask[], private readonly persist: (tasks: SlackTask[]) => void, private readonly now: () => number = Date.now) {
    for (const t of initial) this.tasks.set(t.thread, t)
  }

  /** Idempotent: an open or done task is returned (a done one reopened). */
  open(thread: string, text: string): SlackTask {
    const found = this.tasks.get(thread)
    if (found === undefined) {
      const task: SlackTask = { thread, text, startedAt: this.now(), state: 'open', sessions: [], residents: [], autoAllow: [], lastReplyTs: null }
      this.tasks.set(thread, task)
      this.changed()
      return task
    }
    if (found.state === 'done') { found.state = 'open'; this.changed() }
    return found
  }

  get(thread: string): SlackTask | null { return this.tasks.get(thread) ?? null }

  /** Open first, then done, newest first; done tasks are kept 7 days, at most 200. */
  list(): SlackTask[] {
    const cutoff = this.now() - DONE_KEPT_MS
    const all = [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt)
    const open = all.filter((t) => t.state === 'open')
    const done = all.filter((t) => t.state === 'done' && t.startedAt >= cutoff).slice(0, DONE_KEPT_MAX)
    return [...open, ...done]
  }

  addSession(thread: string, sessionId: string): void { this.edit(thread, (t) => { t.sessions = add(t.sessions, sessionId) }) }
  removeSession(thread: string, sessionId: string): void {
    this.edit(thread, (t) => { t.sessions = t.sessions.filter((s) => s !== sessionId); t.autoAllow = t.autoAllow.filter((s) => s !== sessionId) })
  }
  addResident(thread: string, residentId: string): void { this.edit(thread, (t) => { t.residents = add(t.residents, residentId) }) }
  setAutoAllow(thread: string, sessionId: string): void { this.edit(thread, (t) => { t.autoAllow = add(t.autoAllow, sessionId) }) }
  setLastReply(thread: string, ts: string): void { this.edit(thread, (t) => { t.lastReplyTs = ts }) }

  /** The open task watching `sessionId`. */
  taskOfSession(sessionId: string): SlackTask | null {
    return this.list().find((t) => t.state === 'open' && t.sessions.includes(sessionId)) ?? null
  }

  /** The newest open task `residentId` works for. */
  taskOfResident(residentId: string): SlackTask | null {
    return this.list().find((t) => t.state === 'open' && t.residents.includes(residentId)) ?? null
  }

  /** Done; sessions, residents and autoAllow cleared. */
  finish(thread: string): void {
    this.edit(thread, (t) => { t.state = 'done'; t.sessions = []; t.residents = []; t.autoAllow = [] })
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private edit(thread: string, change: (task: SlackTask) => void): void {
    const task = this.tasks.get(thread)
    if (task === undefined) return
    change(task)
    this.changed()
  }

  private changed(): void {
    this.persist(this.list())
    for (const l of this.listeners) l()
  }
}
