import type { SessionId } from './ids'
import type { ChatPermissionMode } from './chat'

/**
 * Resident agents: always-on agents that live in Apiary (the first is Regent, a chief of staff over
 * every Claude session). A *kind* is declared in code (`src/main/residents/kinds.ts`); a *resident*
 * is a configured instance of one, with its own name, schedule, model and private space. What
 * crosses to the renderer is data only — the appearance is chosen from closed sets the renderer
 * knows how to draw, as status-bar plugins' icons are.
 */

export const RESIDENT_KINDS = ['regent', 'mr-desk'] as const
export type ResidentKindId = (typeof RESIDENT_KINDS)[number]

/** Regent is a bee in a gold halo; the MR desk a honey pot whose dipper stirs, in an amber glow. */
export type ResidentGlyph = 'bee' | 'honeypot'
export type ResidentPalette = 'gold' | 'amber'
export type ResidentAnimation = 'halo' | 'stir'

export interface ResidentAppearance {
  glyph: ResidentGlyph
  palette: ResidentPalette
  animation: ResidentAnimation
}

/** Days are 0 (Sunday) to 6; `start`/`end` are local `HH:MM`, and an `end` at or before `start` crosses midnight. */
export interface ResidentSchedule {
  days: number[]
  start: string
  end: string
}

export interface ResidentConfig {
  id: string
  kind: ResidentKindId
  name: string
  enabled: boolean
  /** A `claude --model` value: an alias or a full id. */
  model: string
  digestModel: string
  schedule: ResidentSchedule
  /** Background work pauses at or above this share of the 5-hour limit; 0 never pauses. */
  pauseAboveUsagePercent: number
  /** How its claude asks before using a tool, as chat mode offers (`auto` by default). */
  permissionMode: ChatPermissionMode
  /** How far back the digest reaches, by last activity; null digests the whole history. */
  digestLookback: DigestLookback | null
  /** The kind's own settings (the MR desk's GitLab project and clone), by the kind's field keys. */
  options: Record<string, string>
  /** How often a kind with a cycle runs it, one of `CYCLE_MINUTES`; null is the kind's default. */
  cycleEveryMinutes: number | null
}

/** The choices for how often a cycle runs. */
export const CYCLE_MINUTES = [5, 10, 15, 30, 60] as const

/** The quick-action id that runs a kind's cycle now ("Check now" in Settings). */
export const CYCLE_ACTION_ID = 'cycle'

/** A kind's cycle as the status reports it. */
export interface ResidentCycle {
  everyMinutes: number
  /** When the next one is due (epoch ms); off duty, the first one after it comes on duty; null when it never will. */
  nextAt: number | null
  /** Whether the turn running now is a cycle Apiary started. */
  running: boolean
}

export interface DigestLookback {
  amount: number
  unit: 'days' | 'weeks' | 'months'
}

/** Something a resident needs the user for (MRs waiting, a question): drives the "needs you" look. */
export interface ResidentAttention {
  /** How many things wait; 0 with a summary is a single unnumbered thing. */
  count: number
  summary: string
}

/** The attention a resident shows while a tool use waits for Allow or Deny. */
export const WAITING_FOR_OK = 'Waiting for your OK'

/** A tool use its claude is waiting on the user to allow or deny, shown in the popup. */
export interface ResidentPermissionRequest {
  requestId: string
  tool: string
  /** One line saying what it wants to do ("Run: glab mr list"). */
  summary: string
}

/** A right-click action on the badge; the kind declares them, main runs them by id. */
export interface ResidentQuickAction {
  id: string
  label: string
}

/** asleep: disabled, or outside its schedule with nothing running. working: answering or digesting. */
export type ResidentState = 'asleep' | 'idle' | 'working'

export interface ResidentStatus {
  id: string
  kind: ResidentKindId
  name: string
  enabled: boolean
  state: ResidentState
  /** A few words on what it is doing now ("Reading API auth"); never null while `working`. */
  activity: string | null
  /** Whether its schedule is active now. */
  onDuty: boolean
  appearance: ResidentAppearance
  /** Background digest progress, or null for a kind that does not digest. */
  digest: { done: number; total: number } | null
  /** What it needs the user for, or null. */
  attention: ResidentAttention | null
  /** Tool uses waiting for Allow or Deny, oldest first. */
  permissions: ResidentPermissionRequest[]
  /** The kind's own right-click actions, after the common ones (open chat, settings, pause). */
  quickActions: ResidentQuickAction[]
  /** Why it cannot run yet ("Set the GitLab project in Settings"), or null when it is ready. */
  setupNeeded: string | null
  /** Its kind's cycle, or null for a kind without one. */
  cycle: ResidentCycle | null
}

export interface ResidentMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Epoch ms. */
  at: number
  /** True while the assistant is still writing it. */
  streaming: boolean
  /** A quick action the person chose (its label), drawn as a chip rather than a bubble. */
  action?: true
}

/** A message added or updated (matched by `message.id`). */
export interface ResidentMessagePush {
  residentId: string
  message: ResidentMessage
}

export type SessionHitReason = 'ref' | 'topic' | 'text' | 'title'

/** A session `find_sessions` (or the instant matches) found, and why. */
export interface SessionHit {
  sessionId: SessionId
  title: string
  folder: string
  branch: string | null
  /** Epoch ms. */
  lastActive: number
  reason: SessionHitReason
  /** The matched topic's title, when the hit came from a digest. */
  topic: string | null
  snippet: string | null
}

/** The link form an answer uses to cite a session; the renderer draws it as a chip that opens it. */
export const SESSION_LINK_PREFIX = 'apiary://session/'

/** One of a kind's own settings, as the Settings section draws it. A folder is picked in main, never typed. */
export interface ResidentOptionField {
  key: string
  label: string
  help: string
  input: 'text' | 'folder'
  required: boolean
}

/** What the renderer knows of a kind: enough to offer "Add …" and draw its option fields. */
export interface ResidentKindInfo {
  id: ResidentKindId
  defaultName: string
  blurb: string
  optionFields: ResidentOptionField[]
  /** Whether it drives the background digest (so the lookback and Re-digest apply). */
  digests: boolean
  appearance: ResidentAppearance
  /** Its cycle's default interval in minutes, or null for a kind without a cycle. */
  cycleMinutes: number | null
}
