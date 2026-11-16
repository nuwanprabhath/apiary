import { randomUUID } from 'node:crypto'
import { errorMessage } from '@shared/errors'
import type { SessionId } from '@shared/domain/ids'
import {
  SCHEDULE_MAX_AHEAD_MS, SCHEDULE_TEXT_MAX, anHourFromNow,
  type ScheduleDefault, type ScheduledMessage, type ScheduleNotice, type ScheduleRequest, type SchedulesState,
} from '@shared/domain/schedule'
import { fireAndForget } from '../log/fireAndForget'
import { log } from '../log/logger'
import { AFTER_RESET_MS } from './limitReset'
import type { OsScheduler } from './osScheduler'
import { STALE_RUNNING_MS, type JobLaunch, type JobResult } from './scheduledJobs'
import type { ScheduleFile } from './scheduleStore'

/** A schedule that came due this long ago with nothing to send it is shown as missed, never sent on its own. */
export const MISSED_AFTER_MS = 12 * 60 * 60_000
/** The longest one timer waits; re-armed then, so a clock change or a sleep cannot stretch it. */
export const MAX_TIMER_MS = 5 * 60_000
/** How soon to look again while the OS job is sending a schedule. */
const IN_FLIGHT_RECHECK_MS = 30_000

export interface ScheduleServiceDeps {
  store: { load(): ScheduleFile; save(file: ScheduleFile): void }
  os: OsScheduler
  jobs: {
    write(id: string, launch: JobLaunch): void
    remove(id: string): void
    result(id: string): JobResult | null
    runningSince(id: string): number | null
    logTail(id: string): string
  }
  /** The session's folder and account, from main's own store (throws for an unknown session). */
  session: (sessionId: SessionId) => { cwd: string; account: string }
  /** What the OS job runs `claude` with, under the account: its environment comes from `AccountService.launchEnv`. */
  launch: (account: string) => Pick<JobLaunch, 'claudeBin' | 'shell' | 'env' | 'model'>
  /** Sends into the session's live chat or terminal, or starts its chat headlessly and sends. */
  deliver: (sessionId: SessionId, text: string) => Promise<void>
  /** When the session's limit resets, from the usage meter or the transcript; null when nothing says. */
  limitResetsAt: (sessionId: SessionId) => { at: number; source: 'usage' | 'transcript' } | null
  onChanged: (state: SchedulesState) => void
  now?: () => number
}

/**
 * Scheduled messages (`main/schedule/`): one record per message in `scheduled-messages.json`, and
 * two ways it goes out, whichever comes first. With Apiary running, a timer here delivers it
 * through the session's live process (`deliver`). With Apiary closed, the OS job registered when it
 * was saved runs `bin/apiary-scheduled`, which sends with `claude -p` and leaves a `.done` that the
 * next start turns into a notice. The timer removes the OS job before it delivers, and the script
 * sends nothing while Apiary's pid is alive, so a message goes once.
 */
export class ScheduleService {
  private file: ScheduleFile = { messages: [], notices: [] }
  private osJobs = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Schedules being sent now, so a timer and "Send now" cannot send one twice. */
  private readonly firing = new Set<string>()
  private disposed = false

  constructor(private readonly deps: ScheduleServiceDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)() }

  /** Loads the file, turns what the OS jobs sent into notices, marks the long-overdue as missed, and arms the timer. */
  async start(): Promise<void> {
    this.file = this.deps.store.load()
    this.osJobs = await this.deps.os.available()
    this.reconcile()
    this.arm()
  }

  /** After the machine wakes: what came due while it slept goes now. */
  resume(): void {
    this.reconcile()
    this.arm()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  state(sessionId: SessionId | null = null): SchedulesState {
    const mine = <T extends { sessionId: string }>(xs: T[]): T[] => (sessionId === null ? xs : xs.filter((x) => x.sessionId === sessionId))
    return {
      messages: mine(this.file.messages).sort((a, b) => a.at - b.at),
      notices: mine(this.file.notices),
      osJobs: this.osJobs,
    }
  }

  /** Creates a schedule, or replaces the one `request.id` names; its OS job is registered anew. */
  async set(request: ScheduleRequest): Promise<ScheduledMessage> {
    const text = request.text.trim()
    if (text === '') throw new Error('Type the message to send')
    if (text.length > SCHEDULE_TEXT_MAX) throw new Error(`A scheduled message is at most ${String(SCHEDULE_TEXT_MAX)} characters`)
    const now = this.now()
    if (request.at <= now) throw new Error('Pick a time in the future')
    if (request.at > now + SCHEDULE_MAX_AHEAD_MS) throw new Error('Pick a time within 30 days')
    if (request.id !== null && !this.file.messages.some((m) => m.id === request.id)) throw new Error('That schedule is gone')
    const { cwd, account } = this.deps.session(request.sessionId)
    if (request.id !== null) await this.dropJob(request.id)
    const message: ScheduledMessage = { id: request.id ?? randomUUID(), sessionId: request.sessionId, text, at: request.at, createdAt: now, account }
    this.file = { ...this.file, messages: [...this.file.messages.filter((m) => m.id !== message.id), message] }
    this.save()
    await this.registerJob(message, cwd)
    this.arm()
    this.changed()
    return message
  }

  /** Cancels a schedule, or dismisses a notice; an unknown id is already gone. */
  async cancel(id: string): Promise<void> {
    const had = this.file.messages.some((m) => m.id === id) || this.file.notices.some((n) => n.id === id)
    if (!had) return
    await this.dropJob(id)
    this.file = { messages: this.file.messages.filter((m) => m.id !== id), notices: this.file.notices.filter((n) => n.id !== id) }
    this.save()
    this.arm()
    this.changed()
  }

  /** Sends a schedule at once, missed or not. */
  async sendNow(id: string): Promise<void> {
    const message = this.file.messages.find((m) => m.id === id)
    if (message === undefined) throw new Error('That schedule is gone')
    await this.fire(message)
  }

  /** The time the popup suggests: 5 minutes after the limit resets when that is known and ahead, else an hour from now. */
  defaultFor(sessionId: SessionId): ScheduleDefault {
    const now = this.now()
    const reset = this.deps.limitResetsAt(sessionId)
    if (reset !== null && reset.at > now - AFTER_RESET_MS) return { at: Math.max(reset.at + AFTER_RESET_MS, now + 60_000), source: reset.source, resetsAt: reset.at }
    return { at: anHourFromNow(now), source: 'hour', resetsAt: null }
  }

  private reconcile(): void {
    const now = this.now()
    let touched = false
    for (const message of this.file.messages) {
      const result = this.deps.jobs.result(message.id)
      if (result !== null) {
        this.toNotice(message, result)
        touched = true
      } else if (message.missed !== true && message.at < now - MISSED_AFTER_MS && this.deps.jobs.runningSince(message.id) === null) {
        this.file = { ...this.file, messages: this.file.messages.map((m) => (m.id === message.id ? { ...m, missed: true } : m)) }
        // A launchd calendar job would come round again next year.
        fireAndForget(this.deps.os.remove(message.id), 'schedule')
        touched = true
      }
    }
    if (!touched) return
    this.save()
    this.changed()
  }

  /** The OS job sent it: the schedule becomes a notice, shown once in that chat. */
  private toNotice(message: ScheduledMessage, result: JobResult): void {
    const ok = result.code === 0
    const notice: ScheduleNotice = {
      id: message.id, sessionId: message.sessionId, text: message.text, at: result.at, ok, whileClosed: true,
      detail: ok ? null : (result.logTail !== '' ? result.logTail : `claude exited with ${String(result.code)}`),
    }
    this.file = { messages: this.file.messages.filter((m) => m.id !== message.id), notices: [...this.file.notices.filter((n) => n.id !== message.id), notice] }
    this.deps.jobs.remove(message.id)
  }

  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.disposed) return
    const waiting = this.file.messages.filter((m) => m.missed !== true)
    if (waiting.length === 0) return
    const now = this.now()
    const inFlight = waiting.some((m) => this.deps.jobs.runningSince(m.id) !== null)
    const soonest = Math.min(...waiting.map((m) => m.at))
    const delay = Math.min(Math.max(0, soonest - now), inFlight ? IN_FLIGHT_RECHECK_MS : MAX_TIMER_MS)
    this.timer = setTimeout(() => { this.timer = null; fireAndForget(this.fireDue(), 'schedule') }, delay)
  }

  private async fireDue(): Promise<void> {
    const now = this.now()
    for (const message of this.file.messages.filter((m) => m.missed !== true && m.at <= now)) await this.fire(message)
    this.arm()
  }

  private async fire(message: ScheduledMessage): Promise<void> {
    if (this.firing.has(message.id)) return
    this.firing.add(message.id)
    try {
      const result = this.deps.jobs.result(message.id)
      if (result !== null) {
        this.toNotice(message, result)
        this.save()
        this.changed()
        return
      }
      const runningSince = this.deps.jobs.runningSince(message.id)
      if (runningSince !== null) {
        // The OS job is sending it; one that never finished may have sent it, so it is not sent again.
        if (this.now() - runningSince < STALE_RUNNING_MS) return
        this.toNotice(message, { code: -1, at: runningSince, logTail: this.deps.jobs.logTail(message.id) || 'The send while Apiary was closed did not finish.' })
        this.save()
        this.changed()
        return
      }
      await this.dropJob(message.id)
      this.file = { ...this.file, messages: this.file.messages.filter((m) => m.id !== message.id) }
      this.save()
      this.changed()
      await this.deliver(message)
    } finally {
      this.firing.delete(message.id)
      this.arm()
    }
  }

  private async deliver(message: ScheduledMessage): Promise<void> {
    try {
      await this.deps.deliver(message.sessionId, message.text)
      log.info('schedule', 'sent', { id: message.id, sessionId: message.sessionId })
    } catch (error) {
      const detail = errorMessage(error)
      log.warn('schedule', 'send failed', { id: message.id, sessionId: message.sessionId, error: detail })
      const notice: ScheduleNotice = { id: message.id, sessionId: message.sessionId, text: message.text, at: this.now(), ok: false, whileClosed: false, detail }
      this.file = { ...this.file, notices: [...this.file.notices.filter((n) => n.id !== message.id), notice] }
      this.save()
      this.changed()
    }
  }

  private async registerJob(message: ScheduledMessage, cwd: string): Promise<void> {
    if (!this.osJobs) return
    try {
      this.deps.jobs.write(message.id, {
        sessionId: message.sessionId, cwd, text: message.text, at: message.at, jobKind: this.deps.os.kind,
        ...this.deps.launch(message.account ?? ''),
      })
      await this.deps.os.register(message.id, message.at)
    } catch (error) {
      // Apiary's own timer still sends it while Apiary is open.
      log.warn('schedule', 'could not register the OS job', { id: message.id, error: errorMessage(error) })
    }
  }

  private async dropJob(id: string): Promise<void> {
    try {
      await this.deps.os.remove(id)
    } catch (error) {
      log.warn('schedule', 'could not remove the OS job', { id, error: errorMessage(error) })
    }
    this.deps.jobs.remove(id)
  }

  private save(): void {
    try {
      this.deps.store.save(this.file)
    } catch (error) {
      log.warn('schedule', 'could not save the schedules', { error: errorMessage(error) })
    }
  }

  private changed(): void { this.deps.onChanged(this.state()) }
}
