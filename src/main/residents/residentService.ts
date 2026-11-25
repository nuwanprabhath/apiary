import type {
  ResidentConfig, ResidentKindId, ResidentKindInfo, ResidentMessage, ResidentMessagePush, ResidentPermissionRequest, ResidentStatus, ResidentTurn, ResidentTurnOrigin, SessionHit,
} from '@shared/domain/residents'
import { CYCLE_ACTION_ID } from '@shared/domain/residents'
import type { PrivacyFeature } from '@shared/domain/privacy'
import { digestPausedFor, gateAllows, type ResidentGate } from './residentPrivacy'
import type { DigestJob, SessionKnowledge } from '../knowledge/types'
import type { LoginShellSpawn } from '../exec/spawnLoginShell'
import { fireAndForget } from '../log/fireAndForget'
import { log } from '../log/logger'
import { STARTING } from './activity'
import { cycleDue } from './cycleDue'
import { instantHits, instantMatchPolicy } from './instantMatches'
import { approvalControlFor } from './approvalControl'
import { kindInfos, kindOf, newResident, unknownKindFilter, type ResidentKind } from './kinds'
import { McpServer } from './mcp/server'
import type { DeskControls } from './mcp/deskControl'
import type { ResidentControl, ToolDeps } from './mcp/toolKit'
import { expandArgv } from './quickActions'
import { commandActionText, runCommand, type RunCommand } from './quickActionCommand'
import { prepareResident } from './residentPrepare'
import { ResidentDigest } from './residentDigest'
import { createResident, launchKey } from './residentCreate'
import { ResidentOutside, type ResidentName } from './residentDelegation'
import { Listeners } from './residentListeners'
import { residentStatusReport } from './residentStatusReport'
import { isOnDuty } from '@shared/residentSchedule'
import { dueTimes } from './residentDue'
import { PendingChecks } from './pendingChecks'
import { residentStatus, type Resident } from './residentStatus'

/** Off duty, a resident's idle claude is stopped after this long. */
const IDLE_STOP_MS = 20 * 60 * 1000
/** A sleep or a clock change can leave the boundary timer late; this re-check bounds how late. */
const RECHECK_MS = 5 * 60 * 1000
/** Status changes inside this window go out as one `residentsChanged`. */
const STATUS_COALESCE_MS = 50
const SEND_MAX = 8000
const noResident = (id: string): never => { throw new Error(`No resident ${id}`) }
/** The index is asked for more than the three shown, so dropping weak title hits still leaves some. */
const INSTANT_CANDIDATES = 6

/** The `residents` setting, as the service reads and writes it. */
export interface ResidentSettings {
  get(): ResidentConfig[]
  /** Saved through the schema's constraint, as a change from the renderer is. */
  set(list: ResidentConfig[]): void
  onChange(fn: () => void): () => void
}

export interface ResidentServiceDeps {
  settings: ResidentSettings
  /** `userData/residents`: each resident's space is a folder in it. */
  root: string
  /** Null until the knowledge index is wired in: the session tools say so, and there are no instant matches. */
  knowledge: SessionKnowledge | null
  /** Null until the digester is wired in: the digest is a no-op and `digest` in the status is null. */
  digest: DigestJob | null
  /** The 5-hour usage the Claude usage plugin last fetched, in percent, or null when it has none. */
  usagePercent: () => number | null
  claudeBin: () => string | undefined
  /** The default account's launch environment. */
  launchEnv: () => Record<string, string>
  /** What the tools reach: sessions by id, the open tabs, and opening a session in the front window. */
  tools: Omit<ToolDeps, 'knowledge' | 'residents'>
  onChanged: (statuses: ResidentStatus[]) => void
  onMessage: (push: ResidentMessagePush) => void
  version: string
  /** Settings → Privacy: the digest and the scheduled cycles run only when it allows them. Absent: everything is allowed. */
  privacyGate?: ResidentGate
  now?: () => Date
  spawn?: LoginShellSpawn
  run?: RunCommand
  /** The built-in kinds; a test passes kinds of its own (a quick action, a cycle). */
  kindOf?: (id: ResidentKindId) => ResidentKind
}

/**
 * The resident agents: starts and stops each one's claude from the `residents` setting and its
 * schedule, drives the background digest and each kind's cycle, owns each one's status and routes
 * the popup's chat, permission answers and quick actions. Nothing here names a kind.
 * Built once, in `createContainer`; `start()` (from `index.ts`) is what arms its timers.
 */
export class ResidentService {
  private readonly residents = new Map<string, Resident>()
  private readonly server: McpServer
  private readonly now: () => Date
  private readonly run: RunCommand
  private readonly kindOf: (id: ResidentKindId) => ResidentKind
  private readonly runnable: (c: ResidentConfig) => boolean
  private timer: NodeJS.Timeout | null = null
  private recheck: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private lastStatus = ''
  /** Orders actions and turns, so the most recently started one's words win. */
  private seq = 0
  private readonly offs: (() => void)[] = []
  private readonly outside = new ResidentOutside({
    require: (id) => this.require(id), all: () => [...this.residents.values()], nextSeq: () => ++this.seq,
    stateOf: (r) => this.statusOf(r, this.now()).state, now: () => this.now().getTime(),
    reconcile: () => { this.reconcile() }, statusChanged: () => { this.statusChanged() },
    cycle: (r, origin) => { this.sendCycle(r, origin) },
  })
  private desk: DeskControls | null = null
  private readonly digest: ResidentDigest
  private readonly turnEnded = new Listeners<[ResidentTurn]>()
  private readonly permissionsHeard = new Listeners<[string, ResidentPermissionRequest[]]>()
  private readonly pending = new PendingChecks({ now: () => this.now().getTime(), onChange: () => { this.statusChanged() } })

  constructor(private readonly deps: ResidentServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.digest = new ResidentDigest(deps.digest, () => this.allows('backgroundDigest'))
    this.run = deps.run ?? runCommand
    this.kindOf = deps.kindOf ?? kindOf
    this.runnable = unknownKindFilter(this.kindOf, (c) => { log.warn('residents', 'unknown resident kind, not running it', { resident: c.id, kind: c.kind }) })
    this.server = new McpServer({
      version: deps.version,
      tools: { ...deps.tools, knowledge: deps.knowledge, residents: this.control(), desk: () => this.desk, approval: approvalControlFor((id) => this.require(id), (r, argv, extraEnv) => this.runIn(r, argv, extraEnv)) },
      capabilitiesOf: (id) => this.residents.get(id)?.kind.capabilities ?? null,
      spaceOf: (id) => this.require(id).space,
      onToolCall: (id, tool, args) => { this.residents.get(id)?.chat.toolCalled(tool, args) },
    })
  }

  /** Follows the setting and the schedule from now on; returns `dispose`, for quit. */
  start(): () => Promise<void> {
    this.offs.push(this.deps.settings.onChange(() => { this.reconcile() }))
    if (this.deps.privacyGate !== undefined) this.offs.push(this.deps.privacyGate.onChange(() => { this.reconcile() }))
    const offDigest = this.digest.listen(() => { this.statusChanged() })
    if (offDigest !== null) this.offs.push(offDigest)
    this.recheck = setInterval(() => { this.reconcile() }, RECHECK_MS)
    this.reconcile()
    return () => this.dispose()
  }

  async dispose(): Promise<void> {
    for (const off of this.offs.splice(0)) off()
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.recheck !== null) clearInterval(this.recheck)
    if (this.statusTimer !== null) clearTimeout(this.statusTimer)
    this.digest.pause()
    await Promise.all([...this.residents.values()].map((r) => r.chat.stop()))
    await this.server.stop()
  }

  list(): ResidentStatus[] {
    return [...this.residents.values()].map((r) => this.statusOf(r, this.now()))
  }

  kinds(): ResidentKindInfo[] { return kindInfos() }

  /** Appends a resident of `kind` with its defaults and a fresh id. */
  add(kindId: ResidentKindId): ResidentConfig {
    const current = this.deps.settings.get()
    const config = newResident(this.kindOf(kindId), new Set(current.map((c) => c.id)))
    this.deps.settings.set([...current, config])
    this.reconcile()
    return config
  }

  history(id: string): ResidentMessage[] { return this.require(id).chat.history() }

  /** Sends to the resident's claude (starting it if needed) and answers at once with the index's best matches. */
  send(id: string, text: string, doing: string | null = null): Promise<SessionHit[]> { return this.sendTurn(id, text, doing, 'user') }

  private async sendTurn(id: string, text: string, doing: string | null, origin: ResidentTurnOrigin): Promise<SessionHit[]> {
    const resident = this.require(id)
    if (!resident.config.enabled) throw new Error(`${resident.config.name} is not enabled`)
    if (text.trim() === '' || text.length > SEND_MAX) throw new Error(`A message is 1 to ${String(SEND_MAX)} characters`)
    resident.turnSeq = ++this.seq
    fireAndForget(resident.chat.send(text, doing, { origin }), 'residents')
    const policy = resident.kind.instantMatches ? instantMatchPolicy(text) : { kind: 'none' as const }
    if (this.deps.knowledge === null || policy.kind === 'none') return []
    return instantHits(policy, await this.deps.knowledge.find(text, INSTANT_CANDIDATES))
  }

  /** A message from outside the popup (see `ResidentOutside`): claude is sent `text`, the chat shows `shown` marked `via`. */
  sendFrom(id: string, o: { text: string; shown: string; via: 'slack' }): void { this.outside.sendFrom(id, o) }

  /** Tells the resident something main knows: claude is sent `text`, the chat shows `label` as a chip. */
  note(id: string, o: { text: string; label: string }): void { this.outside.note(id, o) }

  /** Keeps the resident running off duty until the returned function is called. */
  keepAwake(id: string, reason: string): () => void { return this.outside.keepAwake(id, reason) }

  /** Every finished turn of every resident. Returns how to remove the listener. */
  onTurnEnded(listener: (e: ResidentTurn) => void): () => void { return this.turnEnded.add(listener) }

  /** The waiting permission requests of a resident, each time its list changes. Returns how to remove the listener. */
  onPermissions(listener: (residentId: string, requests: ResidentPermissionRequest[]) => void): () => void { return this.permissionsHeard.add(listener) }

  /** The session driver and Slack the desk tools reach; the desk piece sets them on start and null on stop. */
  setDesk(desk: DeskControls | null): void { this.desk = desk }

  names(): ResidentName[] { return this.outside.names() }

  ask(fromId: string, toName: string, text: string): { id: string; name: string } { return this.outside.ask(fromId, toName, text) }

  check(fromId: string, toName: string): { id: string; name: string } { return this.outside.check(fromId, toName) }

  stop(id: string): void { this.require(id).chat.interrupt() }

  /** A real stop then start, so the new claude re-reads settings, permissions and the kind's prompt. */
  async restart(id: string): Promise<void> {
    const r = this.require(id)
    if (!r.config.enabled) throw new Error(`${r.config.name} is not enabled`)
    await r.chat.restart()
  }

  async clear(id: string): Promise<void> { await this.require(id).chat.clear() }

  /** Prunes a resident's history through its chat, which holds it in memory; null when no chat owns that id. */
  pruneHistoryOlderThan(id: string, cutoffMs: number): number | null {
    return this.residents.get(id)?.chat.pruneOlderThan(cutoffMs) ?? null
  }

  answerPermission(id: string, requestId: string, allow: boolean): void { this.require(id).chat.answerPermission(requestId, allow) }

  /** The user opened its popup: what it flagged for them has been seen. */
  seen(id: string): void {
    const r = this.require(id)
    if (r.space.attention() === null) return
    r.space.setAttention(null)
    this.statusChanged()
  }

  /** Runs one of the kind's quick actions: a prompt goes to the chat, a command's output is added to it. */
  async quickAction(id: string, actionId: string): Promise<void> {
    const r = this.require(id)
    if (actionId === CYCLE_ACTION_ID && r.kind.cycle !== undefined) {
      await this.sendTurn(id, r.kind.cycle.prompt, r.kind.cycle.doing, 'cycle')
      return
    }
    const action = r.kind.quickActions.find((a) => a.id === actionId)
    if (action === undefined) throw new Error(`${r.config.name} has no action ${actionId}`)
    if (action.run.kind === 'prompt') {
      await this.sendTurn(id, action.run.text, action.doing, 'cycle')
      return
    }
    const { argv } = action.run
    r.space.ensure()
    r.chat.appendAction(action.label)
    const text = await this.busyWith(r, action.doing, async () => {
      await r.ready
      return commandActionText(action.label, () => this.runIn(r, argv))
    })
    r.chat.appendAssistant(text)
  }

  /** Shows `doing` as the resident's status from now until `work` settles, however it settles. */
  private async busyWith<T>(r: Resident, doing: string, work: () => Promise<T>): Promise<T> {
    const entry = { doing, seq: ++this.seq }
    r.actions.push(entry)
    this.statusChanged()
    try {
      return await work()
    } finally {
      r.actions = r.actions.filter((a) => a !== entry)
      this.statusChanged()
    }
  }

  /** Stores a folder (picked in main, never typed by the renderer) as one of the resident's folder options. */
  setFolderOption(id: string, key: string, folder: string): string {
    this.requireFolderOption(id, key)
    const list = this.deps.settings.get().map((c) => (c.id === id ? { ...c, options: { ...c.options, [key]: folder } } : c))
    this.deps.settings.set(list)
    return this.deps.settings.get().find((c) => c.id === id)?.options[key] ?? ''
  }

  /** Throws unless the resident's kind has a folder option `key`: checked before the dialog opens. */
  requireFolderOption(id: string, key: string): void {
    const r = this.require(id)
    if (!r.kind.optionFields.some((f) => f.key === key && f.input === 'folder')) throw new Error(`${r.config.name} has no folder option ${key}`)
  }

  /** Forgets every digest and starts over, at once if on duty. */
  async redigest(id: string): Promise<void> {
    this.require(id)
    if (await this.digest.reset()) this.reconcile()
  }

  private require(id: string): Resident {
    return this.residents.get(id) ?? noResident(id)
  }

  /** What the `apiary_status` and attention tools reach, for the resident their token names. */
  private control(): ResidentControl {
    return {
      statusText: (id) => {
        const r = this.require(id)
        const now = this.now()
        const others = [...this.residents.values()].filter((o) => o !== r).map((o) => this.statusOf(o, now))
        return residentStatusReport(r, { now, self: this.statusOf(r, now), others, digest: this.deps.digest })
      },
      setAttention: (id, attention) => { this.require(id).space.setAttention(attention); this.statusChanged() },
      setActivity: (id, text) => { this.require(id).chat.setOwnActivity(text) },
      names: () => this.names(),
      ask: (fromId, toName, text) => this.ask(fromId, toName, text),
      check: (fromId, toName) => this.check(fromId, toName),
    }
  }

  /** Runs the kind's `pending` command for an enabled resident that is set up; the badge shows its answer. */
  private checkPending(r: Resident): void {
    const check = r.kind.pending
    if (check === undefined || !r.config.enabled || r.kind.setup(r.config) !== null) return
    this.pending.refresh(r.config.id, async () => {
      await r.ready
      return check.read(await this.runIn(r, [...check.argv]))
    })
  }

  private runIn(r: Resident, argv: string[], extraEnv: Record<string, string> = {}): Promise<string> {
    const env = { ...this.deps.launchEnv(), ...(r.kind.env?.(r.config, r.space.dir) ?? {}), ...extraEnv }
    return this.run(expandArgv(argv, { options: r.config.options, bins: r.kind.bins }), r.space.dir, env)
  }

  /** Brings every resident's process, the digest, the cycles, the timer and the status in line with the settings and the clock. */
  private reconcile(): void {
    const now = this.now()
    const configs = this.deps.settings.get().filter(this.runnable)
    for (const [id, r] of this.residents) {
      if (!configs.some((c) => c.id === id)) {
        this.residents.delete(id)
        this.pending.forget(id)
        this.server.revokeToken(id)
        fireAndForget(r.chat.stop(), 'residents')
      }
    }
    for (const config of configs) this.reconcileOne(config, now)
    this.reconcileDigest(now)
    for (const r of this.residents.values()) this.reconcileCycle(r, now)
    for (const r of this.residents.values()) {
      if (r.kind.pending !== undefined && this.pending.due(r.config.id, r.kind.pending.everyMinutes)) this.checkPending(r)
    }
    this.arm(now)
    this.statusChanged()
  }

  private reconcileOne(config: ResidentConfig, now: Date): void {
    const r = this.residents.get(config.id) ?? this.create(config)
    const turnedOn = !r.config.enabled && config.enabled
    r.config = config
    prepareResident(r, () => { this.statusChanged() })
    const onDuty = isOnDuty(config.schedule, now)
    const idleTooLong = r.holds.length === 0 && now.getTime() - r.chat.lastActive >= IDLE_STOP_MS
    const stale = r.launchedAs !== null && r.launchedAs !== launchKey(config)
    if (r.chat.running && !r.chat.busy && (!config.enabled || stale || (!onDuty && idleTooLong))) {
      r.launchedAs = null
      fireAndForget(r.chat.stop(), 'residents')
    } else if (config.enabled && onDuty && !r.chat.running) {
      fireAndForget(turnedOn ? this.busyWith(r, STARTING, () => r.chat.start()) : r.chat.start(), 'residents')
    }
  }

  /** Sends the kind's cycle prompt when it is due and the gate allows. */
  private reconcileCycle(r: Resident, now: Date): void {
    const cycle = r.kind.cycle
    if (cycle === undefined || !cycleDue(r, now, this.allows('residentCycles'))) return
    fireAndForget(this.sendTurn(r.config.id, cycle.prompt, cycle.doing, 'cycle'), 'residents')
  }

  /** Check now, or a cycle asked for from outside: sent at once, whatever the timer says. */
  private sendCycle(r: Resident, origin: ResidentTurnOrigin): void {
    const c = r.kind.cycle
    if (c !== undefined) fireAndForget(this.sendTurn(r.config.id, c.prompt, c.doing, origin), 'residents')
  }

  private create(config: ResidentConfig): Resident {
    const created = createResident(config, {
      root: this.deps.root,
      kind: this.kindOf(config.kind),
      server: this.server,
      claudeBin: this.deps.claudeBin,
      launchEnv: this.deps.launchEnv,
      titleOf: (sessionId) => this.deps.tools.session(sessionId)?.title ?? null,
      now: this.now,
      ...(this.deps.spawn !== undefined ? { spawn: this.deps.spawn } : {}),
      onMessage: (r, message) => {
        this.deps.onMessage({ residentId: r.config.id, message })
        // An answer may have added, moved or published something the user still has to finish.
        if (message.role === 'assistant' && !message.streaming) this.checkPending(r)
      },
      onActivity: (r) => {
        this.statusChanged()
        this.hearPermissions(r)
      },
      onTurnEnded: (r, origin, text) => { this.turnEnded.emit({ residentId: r.config.id, text, origin }) },
    })
    this.residents.set(config.id, created)
    return created
  }

  private hearPermissions(r: Resident): void {
    const requests = r.chat.permissions()
    const key = requests.map((q) => q.requestId).join('\n')
    if (key === r.permissionsKey) return
    r.permissionsKey = key
    this.permissionsHeard.emit(r.config.id, requests)
  }

  /** The digest runs while any enabled resident of a digesting kind is on duty, with the first one's model and lookback. */
  private reconcileDigest(now: Date): void {
    const driver = [...this.residents.values()].find((r) => r.kind.digests && r.config.enabled && isOnDuty(r.config.schedule, now))
    const paused = this.digest.reconcile(driver?.config, () => driver !== undefined && this.overUsage(driver.config.id))
    if (paused) this.statusChanged()
  }

  private allows(feature: PrivacyFeature): boolean { return gateAllows(this.deps.privacyGate, feature) }

  private overUsage(id: string): boolean {
    const limit = this.residents.get(id)?.config.pauseAboveUsagePercent ?? 0
    const used = this.deps.usagePercent()
    return limit > 0 && used !== null && used >= limit
  }

  /** One timer, to the earliest schedule boundary, idle stop or cycle. */
  private arm(now: Date): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const due = dueTimes(this.residents.values(), now, IDLE_STOP_MS)
    if (due.length === 0) return
    const wait = Math.max(1000, Math.min(...due) - now.getTime())
    this.timer = setTimeout(() => { this.reconcile() }, Math.min(wait, RECHECK_MS))
  }

  private statusOf(r: Resident, now: Date): ResidentStatus {
    return residentStatus(r, now, {
      digestActivity: this.digest.activity,
      digest: this.deps.digest,
      pending: this.pending.of(r.config.id),
      digestPaused: digestPausedFor(this.deps.privacyGate, this.overUsage(r.config.id)),
      cycleConsent: this.allows('residentCycles'),
    })
  }

  /** Sends `residentsChanged` once things settle, and only when a status really changed. */
  private statusChanged(): void {
    this.statusTimer ??= setTimeout(() => {
      this.statusTimer = null
      const statuses = this.list()
      const key = JSON.stringify(statuses)
      if (key === this.lastStatus) return
      this.lastStatus = key
      this.deps.onChanged(statuses)
    }, STATUS_COALESCE_MS)
  }
}
