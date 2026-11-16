import { isRecord } from '../guards'
import { UUID_RE, type SessionId } from './ids'

/** The longest message a schedule may carry. */
export const SCHEDULE_TEXT_MAX = 10_000
/** How far ahead a message may be scheduled. */
export const SCHEDULE_MAX_AHEAD_MS = 30 * 24 * 60 * 60_000

/** A message main will send into a session at `at` (epoch ms), with Apiary open or closed. */
export interface ScheduledMessage {
  id: string
  sessionId: SessionId
  text: string
  at: number
  createdAt: number
  /** The account the session runs under, recorded when it was scheduled. */
  account?: string
  /** It came due while Apiary and the OS job could not send it (more than 12 hours ago): shown, never sent on its own. */
  missed?: boolean
}

/** What became of a schedule the person did not watch go out: sent while Apiary was closed, or a send that failed. */
export interface ScheduleNotice {
  id: string
  sessionId: SessionId
  text: string
  /** When it was sent, or failed. */
  at: number
  ok: boolean
  /** Sent by the OS job while Apiary was closed (true), or by Apiary itself (false). */
  whileClosed: boolean
  /** Why it failed: the error, or the tail of the job's log. Null when it worked. */
  detail: string | null
}

export interface SchedulesState {
  messages: ScheduledMessage[]
  notices: ScheduleNotice[]
  /** Whether this machine can send while Apiary is closed (launchd, a systemd user timer or `at`). */
  osJobs: boolean
}

/** A schedule to create (`id` null) or replace (`id` of one that exists). */
export interface ScheduleRequest {
  id: string | null
  sessionId: SessionId
  text: string
  at: number
}

/** Where the suggested time came from: the usage meter's reset, the session's "You've hit your limit" line, or neither. */
export type ScheduleDefaultSource = 'usage' | 'transcript' | 'hour'

export interface ScheduleDefault {
  at: number
  source: ScheduleDefaultSource
  /** When the limit resets, for "5 min after your limit resets at 3:00 pm"; null for `hour`. */
  resetsAt: number | null
}

/** A schedule id is a UUID main minted: it names files and an OS job, so nothing else gets through. */
export function isScheduleId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** The shape only; main checks the text, the time and the session. */
export function isScheduleRequest(v: unknown): v is ScheduleRequest {
  return isRecord(v)
    && (v.id === null || isScheduleId(v.id))
    && typeof v.sessionId === 'string'
    && typeof v.text === 'string'
    && typeof v.at === 'number' && Number.isFinite(v.at)
}

/** The suggested time when nothing says when a limit resets: an hour from now, up to the next 5 minutes. */
export function anHourFromNow(now: number): number {
  const step = 5 * 60_000
  return Math.ceil((now + 60 * 60_000) / step) * step
}
