import type {
  ResidentAttention, ResidentConfig, ResidentKindId, ResidentKindInfo, ResidentMessage, ResidentMessagePush, ResidentState, ResidentStatus, SessionHit,
} from '@shared/domain/residents'
import { CYCLE_ACTION_ID, WAITING_FOR_OK } from '@shared/domain/residents'
import { errorMessage } from '@shared/errors'
import type { DigestJob, SessionKnowledge } from '../knowledge/types'
import type { LoginShellSpawn } from '../exec/spawnLoginShell'
import { createExec } from '../exec/run'
import { fireAndForget } from '../log/fireAndForget'
import { log } from '../log/logger'
import { clipActivity, STARTING, WORKING } from './activity'
import { cycleMinutesOf, cycleStatus } from './cycle'
import { instantHits, instantMatchPolicy } from './instantMatches'
import { kindInfos, kindOf, newResident, type ResidentKind } from './kinds'
import { McpServer } from './mcp/server'
import type { ResidentControl, ToolDeps } from './mcp/tools'
import { cycleSkip, expandArgv } from './quickActions'
import { ResidentChat } from './residentChat'
import { ResidentSpace } from './residentSpace'
import { apiaryStatusText } from './statusText'
import { isOnDuty, nextChange } from '@shared/residentSchedule'

/** Off duty, a resident's idle claude is stopped after this long. */
const IDLE_STOP_MS = 20 * 60 * 1000
/** A sleep or a clock change can leave the boundary timer late; this re-check bounds how late. */
const RECHECK_MS = 5 * 60 * 1000
/** A cycle that found its resident busy or waiting on the user tries again this much later. */
const CYCLE_RETRY_MS = 60 * 1000
/** Status changes inside this window go out as one `residentsChanged`. */
const STATUS_COALESCE_MS = 50
const SEND_MAX = 8000
const COMMAND_TIMEOUT_MS = 60 * 1000
const COMMAND_OUTPUT_MAX = 20_000
/** The index is asked for more than the three shown, so dropping weak title hits still leaves some. */
const INSTANT_CANDIDATES = 6

/** The `residents` setting, as the service reads and writes it. */
export interface ResidentSettings {
  get(): ResidentConfig[]
  /** Saved through the schema's constraint, as a change from the renderer is. */
  set(list: ResidentConfig[]): void
  onChange(fn: () => void): () => void
}

/** Runs a quick action's argv (execFile, no shell) in `cwd` with `env` added; resolves with stdout. */
export type RunCommand = (argv: string[], cwd: string, env: Record<string, string>) => Promise<string>

const runCommand: RunCommand = (argv, cwd, env) =>
  createExec({ timeoutMs: COMMAND_TIMEOUT_MS, scope: 'residents', env })(argv[0], argv.slice(1), cwd)

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
  now?: () => Date
  spawn?: LoginShellSpawn
  run?: RunCommand
  /** The built-in kinds; a test passes kinds of its own (a quick action, a cycle). */
  kindOf?: (id: ResidentKindId) => ResidentKind
}

interface Resident {
  config: ResidentConfig
  kind: ResidentKind
  space: ResidentSpace
  chat: ResidentChat
  /** What its running claude was started with; a change restarts it once it is idle. */
  launchedAs: string | null
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
}

const launchKey = (c: ResidentConfig): string =>
  `${c.model}\n${c.name}\n${c.permissionMode}\n${String(c.cycleEveryMinutes)}\n${JSON.stringify(c.options)}`

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
  private timer: NodeJS.Timeout | null = null
  private recheck: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private lastStatus = ''
  private digestKey: string | null = null
  private digestActivity: string | null = null
  /** Orders actions and turns, so the most recently started one's words win. */
  private seq = 0
  private readonly offs: (() => void)[] = []

  constructor(private readonly deps: ResidentServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.run = deps.run ?? runCommand
    this.kindOf = deps.kindOf ?? kindOf
    this.server = new McpServer({
      version: deps.version,
      tools: { ...deps.tools, knowledge: deps.knowledge, residents: this.control() },
      capabilitiesOf: (id) => this.residents.get(id)?.kind.capabilities ?? null,
      spaceOf: (id) => this.require(id).space,
      onToolCall: (id, tool, args) => { this.residents.get(id)?.chat.toolCalled(tool, args) },
    })
  }

  /** Follows the setting and the schedule from now on; returns `dispose`, for quit. */
  start(): () => Promise<void> {
    this.offs.push(this.deps.settings.onChange(() => { this.reconcile() }))
    if (this.deps.digest !== null) {
      this.offs.push(this.deps.digest.onActivity((activity) => { this.digestActivity = activity; this.statusChanged() }))
    }
    this.recheck = setInterval(() => { this.reconcile() }, RECHECK_MS)
    this.reconcile()
    return () => this.dispose()
  }

  async dispose(): Promise<void> {
    for (const off of this.offs.splice(0)) off()
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.recheck !== null) clearInterval(this.recheck)
    if (this.statusTimer !== null) clearTimeout(this.statusTimer)
    this.deps.digest?.pause()
    await Promise.all([...this.residents.values()].map((r) => r.chat.stop()))
    await this.server.stop()
  }

  list(): ResidentStatus[] {
    const now = this.now()
    return [...this.residents.values()].map((r) => this.statusOf(r, now))
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
  async send(id: string, text: string, doing: string | null = null): Promise<SessionHit[]> {
    const resident = this.require(id)
    if (!resident.config.enabled) throw new Error(`${resident.config.name} is not enabled`)
    if (text.trim() === '' || text.length > SEND_MAX) throw new Error(`A message is 1 to ${String(SEND_MAX)} characters`)
    resident.turnSeq = ++this.seq
    fireAndForget(resident.chat.send(text, doing), 'residents')
    const policy = resident.kind.instantMatches ? instantMatchPolicy(text) : { kind: 'none' as const }
    if (this.deps.knowledge === null || policy.kind === 'none') return []
    return instantHits(policy, await this.deps.knowledge.find(text, INSTANT_CANDIDATES))
  }

  stop(id: string): void { this.require(id).chat.interrupt() }

  async clear(id: string): Promise<void> { await this.require(id).chat.clear() }

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
    if (actionId === CYCLE_ACTION_ID && r.kind.cycle !== undefined) { await this.send(id, r.kind.cycle.prompt, r.kind.cycle.doing); return }
    const action = r.kind.quickActions.find((a) => a.id === actionId)
    if (action === undefined) throw new Error(`${r.config.name} has no action ${actionId}`)
    if (action.run.kind === 'prompt') { await this.send(id, action.run.text, action.doing); return }
    const { argv } = action.run
    r.space.ensure()
    r.chat.appendAction(action.label)
    const text = await this.busyWith(r, action.doing, async () => {
      await r.ready
      try {
        const out = (await this.run(expandArgv(argv, { options: r.config.options, bins: r.kind.bins }), r.space.dir, this.envOf(r))).trim()
        return out === '' ? `**${action.label}**: done, no output.` : out.slice(0, COMMAND_OUTPUT_MAX)
      } catch (e) {
        return `**${action.label}** failed: ${errorMessage(e).split('\n')[0].slice(0, 300)}`
      }
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
    if (this.deps.digest === null) return
    await this.deps.digest.reset()
    this.digestKey = null
    this.reconcile()
  }

  private require(id: string): Resident {
    const resident = this.residents.get(id)
    if (resident === undefined) throw new Error(`No resident ${id}`)
    return resident
  }

  /** What the `apiary_status` and attention tools reach, for the resident their token names. */
  private control(): ResidentControl {
    return {
      statusText: (id) => {
        const r = this.require(id)
        const now = this.now()
        const others = [...this.residents.values()].filter((o) => o !== r).map((o) => this.statusOf(o, now))
        return apiaryStatusText({
          self: this.statusOf(r, now), config: r.config, lookback: r.config.digestLookback,
          index: r.kind.digests ? this.deps.digest?.indexSize() ?? null : null, others, now,
        })
      },
      setAttention: (id, attention) => { this.require(id).space.setAttention(attention); this.statusChanged() },
      setActivity: (id, text) => { this.require(id).chat.setOwnActivity(text) },
    }
  }

  private envOf(r: Resident): Record<string, string> {
    return { ...this.deps.launchEnv(), ...(r.kind.env?.(r.config, r.space.dir) ?? {}) }
  }

  /** Brings every resident's process, the digest, the cycles, the timer and the status in line with the settings and the clock. */
  private reconcile(): void {
    const now = this.now()
    const configs = this.deps.settings.get()
    for (const [id, r] of this.residents) {
      if (!configs.some((c) => c.id === id)) {
        this.residents.delete(id)
        this.server.revokeToken(id)
        fireAndForget(r.chat.stop(), 'residents')
      }
    }
    for (const config of configs) this.reconcileOne(config, now)
    this.reconcileDigest(now)
    for (const r of this.residents.values()) this.reconcileCycle(r, now)
    this.arm(now)
    this.statusChanged()
  }

  private reconcileOne(config: ResidentConfig, now: Date): void {
    const r = this.residents.get(config.id) ?? this.create(config)
    const turnedOn = !r.config.enabled && config.enabled
    r.config = config
    this.prepare(r)
    const onDuty = isOnDuty(config.schedule, now)
    const idleTooLong = now.getTime() - r.chat.lastActive >= IDLE_STOP_MS
    const stale = r.launchedAs !== null && r.launchedAs !== launchKey(config)
    if (r.chat.running && !r.chat.busy && (!config.enabled || stale || (!onDuty && idleTooLong))) {
      r.launchedAs = null
      fireAndForget(r.chat.stop(), 'residents')
    } else if (config.enabled && onDuty && !r.chat.running) {
      fireAndForget(turnedOn ? this.busyWith(r, STARTING, () => r.chat.start()) : r.chat.start(), 'residents')
    }
  }

  /**
   * Runs the kind's `prepare` when its options changed, or again while its `setup` still reports
   * something (so installing a tool is noticed by the next re-check). One run at a time.
   */
  private prepare(r: Resident): void {
    const prepare = r.kind.prepare
    const key = JSON.stringify(r.config.options)
    if (prepare === undefined || r.preparing || (key === r.preparedFor && r.kind.setup(r.config) === null)) return
    r.preparing = true
    r.preparedFor = key
    r.ready = (async () => {
      try {
        r.space.ensure()
        await prepare(r.config, r.space.dir)
      } catch (e) {
        log.warn('residents', 'prepare failed', { resident: r.config.id, error: errorMessage(e) })
      } finally {
        r.preparing = false
        // Options saved while it ran (the project, then the clone) would otherwise wait for the next re-check.
        if (JSON.stringify(r.config.options) !== r.preparedFor) this.prepare(r)
        this.statusChanged()
      }
    })()
  }

  /** Sends the kind's cycle prompt when it is due and the gate allows; a skip is logged with its reason. */
  private reconcileCycle(r: Resident, now: Date): void {
    const cycle = r.kind.cycle
    const minutes = cycleMinutesOf(r.kind, r.config)
    if (cycle === undefined || minutes === null) return
    const every = minutes * 60 * 1000
    if (r.cycleEvery !== minutes) { r.cycleEvery = minutes; r.nextCycleAt = null }
    const skip = cycleSkip({
      enabled: r.config.enabled, onDuty: isOnDuty(r.config.schedule, now), busy: r.chat.busy,
      permissionsWaiting: r.chat.permissions().length, setupNeeded: r.kind.setup(r.config),
    })
    if (skip === 'off duty') { r.nextCycleAt = null; return }
    if (r.nextCycleAt === null) { r.nextCycleAt = now.getTime() + every; return }
    if (now.getTime() < r.nextCycleAt) return
    if (skip !== null) {
      log.info('residents', 'cycle skipped', { resident: r.config.id, reason: skip })
      r.nextCycleAt = now.getTime() + (skip === 'setup needed' ? every : CYCLE_RETRY_MS)
      return
    }
    r.nextCycleAt = now.getTime() + every
    fireAndForget(this.send(r.config.id, cycle.prompt, cycle.doing), 'residents')
  }

  private create(config: ResidentConfig): Resident {
    const kind = this.kindOf(config.kind)
    const space = new ResidentSpace(this.deps.root, config.id)
    // The chat's callbacks read the live config through this object, which becomes the resident.
    const resident: Omit<Resident, 'chat'> = {
      config, kind, space, launchedAs: null, nextCycleAt: null, cycleEvery: null, ready: Promise.resolve(), preparedFor: null, preparing: false,
      actions: [], turnSeq: 0,
    }
    const chat = new ResidentChat({
      space,
      name: () => resident.config.name,
      claudeBin: this.deps.claudeBin,
      env: () => ({ ...this.deps.launchEnv(), ...(kind.env?.(resident.config, space.dir) ?? {}) }),
      titleOf: (sessionId) => this.deps.tools.session(sessionId)?.title ?? null,
      launch: async () => {
        await resident.ready
        const url = await this.server.start()
        resident.launchedAs = launchKey(resident.config)
        return {
          mcpConfig: space.writeMcpConfig(url, this.server.issueToken(config.id)),
          model: resident.config.model,
          systemPrompt: kind.systemPrompt(resident.config.name, cycleMinutesOf(kind, resident.config) ?? undefined),
          permissionMode: resident.config.permissionMode,
        }
      },
      onMessage: (message) => { this.deps.onMessage({ residentId: config.id, message }) },
      onActivity: () => { this.statusChanged() },
      ...(this.deps.spawn !== undefined ? { spawn: this.deps.spawn } : {}),
    })
    const created: Resident = Object.assign(resident, { chat })
    this.residents.set(config.id, created)
    return created
  }

  /** The digest runs while any enabled resident of a digesting kind is on duty, with the first one's model and lookback. */
  private reconcileDigest(now: Date): void {
    const digest = this.deps.digest
    if (digest === null) return
    const driver = [...this.residents.values()].find((r) => r.kind.digests && r.config.enabled && isOnDuty(r.config.schedule, now))
    const key = driver === undefined ? null : `${driver.config.digestModel}\n${JSON.stringify(driver.config.digestLookback)}`
    if (key === this.digestKey) return
    this.digestKey = key
    if (driver === undefined) { digest.pause(); return }
    digest.resume({
      model: driver.config.digestModel,
      lookback: driver.config.digestLookback,
      shouldPause: () => this.overUsage(driver.config.id),
    })
  }

  private overUsage(id: string): boolean {
    const limit = this.residents.get(id)?.config.pauseAboveUsagePercent ?? 0
    const used = this.deps.usagePercent()
    return limit > 0 && used !== null && used >= limit
  }

  /** One timer, to the earliest schedule boundary, idle stop or cycle. */
  private arm(now: Date): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const due: number[] = []
    for (const r of this.residents.values()) {
      if (!r.config.enabled) continue
      const change = nextChange(r.config.schedule, now)
      if (change !== null) due.push(change.getTime())
      if (r.chat.running && !isOnDuty(r.config.schedule, now)) due.push(r.chat.lastActive + IDLE_STOP_MS)
      if (r.nextCycleAt !== null) due.push(r.nextCycleAt)
    }
    if (due.length === 0) return
    const wait = Math.max(1000, Math.min(...due) - now.getTime())
    this.timer = setTimeout(() => { this.reconcile() }, Math.min(wait, RECHECK_MS))
  }

  private attentionOf(r: Resident): ResidentAttention | null {
    const waiting = r.chat.permissions().length
    return waiting > 0 ? { count: waiting, summary: WAITING_FOR_OK } : r.space.attention()
  }

  private statusOf(r: Resident, now: Date): ResidentStatus {
    const onDuty = isOnDuty(r.config.schedule, now)
    const digestActivity = r.kind.digests && r.config.enabled && onDuty ? this.digestActivity : null
    const action = r.actions.at(-1)
    let state: ResidentState = 'idle'
    if (!r.config.enabled) state = 'asleep'
    else if (r.chat.busy || action !== undefined || digestActivity !== null) state = 'working'
    else if (!onDuty) state = 'asleep'
    const actionWords = action !== undefined && (!r.chat.busy || action.seq > r.turnSeq) ? action.doing : null
    // The one place the rule holds: a working resident always says what it is doing.
    const activity = actionWords ?? r.chat.activity() ?? digestActivity ?? (state === 'working' ? WORKING : null)
    const lastAsked = r.chat.history().filter((m) => m.role === 'user' && m.action !== true).at(-1)
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
      digest: r.kind.digests && this.deps.digest !== null ? this.deps.digest.progress() : null,
      attention: this.attentionOf(r),
      permissions: r.chat.permissions(),
      quickActions: r.kind.quickActions.map(({ id, label }) => ({ id, label })),
      setupNeeded: r.kind.setup(r.config),
      cycle: cycleStatus(r.kind, r.config, { nextCycleAt: r.nextCycleAt, running, now }),
    }
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
