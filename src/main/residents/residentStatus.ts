import type { ResidentAttention, ResidentConfig, ResidentPending, ResidentState, ResidentStatus } from '@shared/domain/residents'
import { WAITING_FOR_OK } from '@shared/domain/residents'
import { isOnDuty } from '@shared/residentSchedule'
import type { DigestJob } from '../knowledge/types'
import { clipActivity, WORKING } from './activity'
import { cycleStatus } from './cycle'
import type { ResidentKind } from './kinds'
import type { ResidentChat } from './residentChat'
import type { ResidentSpace } from './residentSpace'
import type { ResidentPermissions } from './statusText'

/** One resident as `ResidentService` holds it. */
export interface Resident {
  config: ResidentConfig
  kind: ResidentKind
  space: ResidentSpace
  chat: ResidentChat
  /** What its running claude was started with; a change restarts it once it is idle. */
  launchedAs: string | null
  /** The permission flags its claude was last started with, for `apiary_status`. */
  permissions: ResidentPermissions | null
  /** When its kind's cycle prompt is next due (epoch ms), or null while it is off duty. Invalidated by a change of `cycleEvery`. */
  nextCycleAt: number | null
  /** The interval `nextCycleAt` was counted with. */
  cycleEvery: number | null
  /** Settles when the kind's `prepare` last finished; claude and commands wait for it. */
  ready: Promise<void>
  /** The options `prepare` last ran for. */
  preparedFor: string | null
  preparing: boolean
  /** Quick actions and starts running outside a turn, oldest first; `seq` orders them against `turnSeq`. */
  actions: { doing: string; seq: number }[]
  /** When its latest turn was asked for, on the service's `seq`. */
  turnSeq: number
  /** Why something wants it awake off duty (`keepAwake`); in memory, one entry per hold. */
  holds: { reason: string }[]
  /** The waiting permission request ids last reported to `onPermissions`. */
  permissionsKey: string
  /** The skip reason last logged for its cycle, so a standing skip is logged once per change. */
  cycleSkipLogged: string | null
}

function attentionOf(r: Resident): ResidentAttention | null {
  const waiting = r.chat.permissions().length
  return waiting > 0 ? { count: waiting, summary: WAITING_FOR_OK } : r.space.attention()
}

/** What the renderer sees of a resident now; the one place a `working` status is made to say what it does. */
export function residentStatus(
  r: Resident, now: Date, ctx: { digestActivity: string | null; digest: DigestJob | null; pending: ResidentPending | null; digestPaused: ResidentStatus['digestPaused']; cycleConsent: boolean },
): ResidentStatus {
  const onDuty = isOnDuty(r.config.schedule, now)
  const digestActivity = r.kind.digests && r.config.enabled && onDuty ? ctx.digestActivity : null
  const action = r.actions.at(-1)
  let state: ResidentState = 'idle'
  if (!r.config.enabled) state = 'asleep'
  else if (r.chat.working || action !== undefined || digestActivity !== null) state = 'working'
  else if (!onDuty && r.holds.length === 0) state = 'asleep'
  const actionWords = action !== undefined && (!r.chat.busy || action.seq > r.turnSeq) ? action.doing : null
  const activity = actionWords ?? r.chat.activity() ?? digestActivity ?? (state === 'working' ? WORKING : null)
  const lastAsked = r.chat.history().filter((m) => m.role === 'user' && m.action !== true && m.note !== true).at(-1)
  const running = r.chat.busy && lastAsked !== undefined && lastAsked.text === r.kind.cycle?.prompt
  return {
    id: r.config.id,
    kind: r.config.kind,
    name: r.config.name,
    enabled: r.config.enabled,
    state,
    activity: r.config.enabled && activity !== null ? clipActivity(activity) : null,
    onDuty,
    appearance: r.kind.appearance,
    digest: r.kind.digests && ctx.digest !== null ? ctx.digest.progress() : null,
    digestPaused: r.kind.digests && r.config.enabled ? ctx.digestPaused : null,
    attention: attentionOf(r),
    pending: r.config.enabled ? ctx.pending : null,
    permissions: r.chat.permissions(),
    quickActions: r.kind.quickActions.map(({ id, label, opensPopup }) => ({ id, label, opensPopup })),
    setupNeeded: r.kind.setup(r.config),
    cycle: cycleStatus(r.kind, r.config, { nextCycleAt: r.nextCycleAt, running, now, consent: ctx.cycleConsent }),
  }
}
