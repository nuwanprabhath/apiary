import type { SlackConfigChange, SlackStatus } from '@shared/domain/slack'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { log } from '../log/logger'
import { SlackApiError, describeSlackError, type SlackApi, type SlackMessage } from './slackApi'
import {
  AWAITING_MS, DEEP_POLL_MS, FAILURE_POLL_MS, STALE_MS, compareTs, isOwnerMessage, msToTs, nextDelay, readAnswer, tsToMs,
} from './slackPoller'
import type { SlackStore } from './slackStore'
import { SlackTasks } from './slackTasks'
import { markdownToSlack, slackToPlain, splitForSlack } from './slackText'

export interface SlackInbound {
  thread: string
  ts: string
  /** Plain text (`slackToPlain`). */
  text: string
  /** `task`: the top-level message that starts a task. `reply`: a reply in a task's thread. */
  kind: 'task' | 'reply'
}

/** True when it consumed the message; the bridge then asks no later handler. */
export type SlackHandler = (message: SlackInbound) => boolean | Promise<boolean>

export interface SlackBridgeOptions {
  store: SlackStore
  api: SlackApi
  now?: () => number
  /** Calls `poll` when the machine wakes from sleep; returns how to stop. */
  onResume?: (poll: () => void) => () => void
  /** Settings → Privacy: the bridge polls only while it allows `slackBridge`. Absent: always. */
  gate?: { allows(feature: 'slackBridge'): boolean; onChange(listener: () => void): () => void }
}

export const WAITING_FOR_CONSENT = 'Waiting for your OK in Settings → Privacy.'

const NOTHING_HERE = "Nothing on this machine is set up to act on Slack messages. Turn on Regent in Apiary's settings."
const ASK_AGAIN = 'I was offline when you sent this. Still want it? Reply yes.'

export class SlackBridge {
  readonly tasks: SlackTasks
  private readonly store: SlackStore
  private readonly api: SlackApi
  private readonly now: () => number
  private readonly onResume: ((poll: () => void) => () => void) | null
  private readonly gate: SlackBridgeOptions['gate'] | null
  private readonly handlers: { order: number; handler: SlackHandler }[] = []
  private readonly listeners = new Set<(status: SlackStatus) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private started = false
  private stopResume: (() => void) | null = null
  private stopGate: (() => void) | null = null
  private connection: SlackStatus['connection'] = 'off'
  private error: string | null = null
  private bot: SlackStatus['bot'] = null
  private canStore = false
  private lastActivityAt = 0
  private lastShown = ''
  /** In memory only: the newest reply seen in a thread awaiting an answer, and when a task's thread was last read without its parent in the window. */
  private readonly awaitingSeen = new Map<string, string>()
  private readonly deepPolled = new Map<string, number>()

  constructor(o: SlackBridgeOptions) {
    this.store = o.store
    this.api = o.api
    this.now = o.now ?? Date.now
    this.onResume = o.onResume ?? null
    this.gate = o.gate ?? null
    this.tasks = new SlackTasks(o.store.state.tasks, (tasks) => { o.store.update({ tasks }) }, this.now)
    this.tasks.onChanged(() => { this.emit() })
  }

  start(): () => Promise<void> {
    this.started = true
    this.stopResume = this.onResume?.(() => { if (this.started) this.schedule(0) }) ?? null
    void this.store.canStoreToken().then((can) => { this.canStore = can; this.emit() })
    this.stopGate = this.gate?.onChange(() => { if (this.started) this.restart() }) ?? null
    this.restart()
    return async () => {
      this.started = false
      this.stopGate?.()
      this.stopGate = null
      this.stopResume?.()
      this.stopResume = null
      this.clearTimer()
      await this.running
    }
  }

  status(): SlackStatus {
    const s = this.store.state
    return {
      enabled: s.enabled, hasToken: s.token !== null, canStoreToken: this.canStore, channel: s.channel, ownerId: s.ownerId,
      bot: this.bot, connection: this.connection, error: this.error,
    }
  }

  handle(order: number, handler: SlackHandler): () => void {
    const entry = { order, handler }
    this.handlers.push(entry)
    this.handlers.sort((a, b) => a.order - b.order)
    return () => { const i = this.handlers.indexOf(entry); if (i >= 0) this.handlers.splice(i, 1) }
  }

  onChanged(listener: (status: SlackStatus) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async configure(change: SlackConfigChange): Promise<SlackStatus> {
    this.canStore = await this.store.canStoreToken()
    if (change.token !== undefined) { await this.store.saveToken(change.token); this.bot = null }
    if (change.ownerId !== undefined) this.store.update({ ownerId: change.ownerId })
    let channelError: string | null = null
    if (change.channel !== undefined) {
      try {
        const found = await this.api.findChannel(change.channel)
        if (found === null) channelError = `Slack has no channel ${change.channel}, or the bot cannot see it. Invite it with /invite @${this.bot?.name ?? 'regent'}.`
        else if (found.id !== this.store.state.channel?.id) this.store.update({ channel: found, cursor: null, awaiting: [] })
      } catch (e) {
        channelError = describeSlackError(e, { channel: change.channel, bot: this.bot?.name ?? null })
      }
    }
    if (change.enabled !== undefined) this.store.update({ enabled: change.enabled })
    this.restart()
    if (this.connection === 'connecting') await this.verify()
    if (channelError !== null) { this.connection = 'error'; this.error = channelError }
    this.emit()
    return this.status()
  }

  async test(): Promise<SlackStatus> {
    this.connection = 'connecting'
    this.error = null
    this.emit()
    await this.verify()
    return this.status()
  }

  /** Who the token is, and whether the bot can read the channel. */
  private async verify(): Promise<void> {
    const { channel, enabled } = this.store.state
    try {
      this.bot = await this.api.authTest()
      if (channel !== null) await this.api.history(channel.id, 1)
      this.connection = enabled ? 'connected' : 'off'
      this.error = null
    } catch (e) {
      this.fail(e)
    }
    this.emit()
  }

  /** Posts Markdown to the channel (thread null) or a thread, split when long; resolves with the first post's `ts`. */
  async post(thread: string | null, text: string): Promise<string> {
    const channel = this.store.state.channel
    if (channel === null) throw new Error('No Slack channel is set.')
    let first: string | null = null
    for (const piece of splitForSlack(markdownToSlack(text))) {
      const ts = await this.api.post(channel.id, piece, thread)
      first ??= ts
    }
    if (first === null) throw new Error('Nothing to post.')
    return first
  }

  /** Adds a reaction (an emoji name) to a message of the channel; a failure is ignored, a reaction being a courtesy. */
  async react(ts: string, name: string): Promise<void> {
    const channel = this.store.state.channel
    if (channel === null) return
    await ignoreErrorsAsync(() => this.api.react(channel.id, ts, name), 'a reaction is a courtesy; the answer was already taken')
  }

  private restart(): void {
    this.clearTimer()
    const s = this.store.state
    const ready = s.enabled && s.channel !== null && s.ownerId !== null && s.token !== null
    if (!s.enabled) { this.connection = 'off'; this.error = null } else if (!ready) {
      this.connection = 'error'
      this.error = s.token === null ? 'Add the bot token to connect.' : s.channel === null ? 'Choose the channel for this machine.' : 'Enter your Slack member id.'
    } else if (!this.allowed()) { this.connection = 'off'; this.error = WAITING_FOR_CONSENT } else { this.connection = 'connecting'; this.error = null }
    this.emit()
    if (ready && this.started) this.schedule(0)
  }

  /** A gate that throws counts as not allowed. */
  private allowed(): boolean {
    try {
      return this.gate?.allows('slackBridge') ?? true
    } catch {
      return false
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number): void {
    this.clearTimer()
    if (!this.allowed()) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.running !== null) { this.schedule(1000); return }
      const run = this.cycle().finally(() => { this.running = null })
      this.running = run
    }, ms)
  }

  /** One poll. The timer is re-armed only here, after the cycle ends, so two never overlap. */
  private async cycle(): Promise<void> {
    let delay: number
    try {
      await this.poll()
      this.connection = 'connected'
      this.error = null
      delay = nextDelay({ openTask: this.tasks.list().some((t) => t.state === 'open'), lastActivityAt: this.lastActivityAt, now: this.now() })
    } catch (e) {
      this.fail(e)
      delay = e instanceof SlackApiError && e.retryAfterMs !== null ? e.retryAfterMs : FAILURE_POLL_MS
    }
    if (!this.allowed()) { this.connection = 'off'; this.error = WAITING_FOR_CONSENT }
    this.emit()
    const s = this.store.state
    if (this.started && s.enabled && s.channel !== null) this.schedule(delay)
  }

  private fail(e: unknown): void {
    this.connection = 'error'
    this.error = describeSlackError(e, { channel: this.store.state.channel?.name ?? null, bot: this.bot?.name ?? null })
    log.warn('slack', 'poll failed', { code: e instanceof SlackApiError ? e.code : 'other' })
  }

  private async poll(): Promise<void> {
    await this.store.ready()
    const { channel, ownerId } = this.store.state
    if (channel === null) return
    this.bot ??= await this.api.authTest()
    const history = (await this.api.history(channel.id, 100)).sort((a, b) => compareTs(a.ts, b.ts))
    if (this.store.state.cursor === null) { this.store.update({ cursor: msToTs(this.now()) }); return }
    this.dropOldAwaiting()
    let ignored = 0
    for (const m of history) {
      const cursor = this.store.state.cursor ?? ''
      if (m.thread !== null || compareTs(m.ts, cursor) <= 0) continue
      if (!isOwnerMessage(m, ownerId)) { ignored++; this.store.update({ cursor: m.ts }); continue }
      await this.takeTopLevel(channel.id, m)
      this.store.update({ cursor: m.ts })
    }
    if (ignored > 0) log.debug('slack', 'ignored messages', { count: ignored })
    await this.pollThreads(channel.id, history)
  }

  private dropOldAwaiting(): void {
    const fresh = this.store.state.awaiting.filter((a) => this.now() - a.askedAt < AWAITING_MS)
    if (fresh.length !== this.store.state.awaiting.length) this.store.update({ awaiting: fresh })
  }

  private async takeTopLevel(channel: string, m: SlackMessage): Promise<void> {
    const text = slackToPlain(m.text)
    if (this.now() - tsToMs(m.ts) > STALE_MS) {
      await this.api.post(channel, ASK_AGAIN, m.ts)
      this.store.update({ awaiting: [...this.store.state.awaiting, { ts: m.ts, text, askedAt: this.now() }] })
      return
    }
    await this.carryOut(channel, m.ts, text)
  }

  /** The `eyes` receipt, the task, then the handlers. */
  private async carryOut(channel: string, thread: string, text: string): Promise<void> {
    this.lastActivityAt = this.now()
    await ignoreErrorsAsync(() => this.api.react(channel, thread, 'eyes'), 'the receipt is a courtesy; the message is carried out without it')
    this.tasks.open(thread, text)
    await this.deliver(channel, { thread, ts: thread, text, kind: 'task' })
  }

  private async deliver(channel: string, message: SlackInbound): Promise<void> {
    for (const { handler } of [...this.handlers]) {
      try {
        if (await handler(message)) return
      } catch {
        log.warn('slack', 'a handler failed', { kind: message.kind })
      }
    }
    await ignoreErrorsAsync(() => this.api.post(channel, NOTHING_HERE, message.thread), 'the notice is a courtesy; the next cycle goes on')
  }

  /** Replies for a task thread whose `latest_reply` moved, an awaiting thread, and (every 30 s) an open task whose parent is out of the window. */
  private async pollThreads(channel: string, history: SlackMessage[]): Promise<void> {
    const parents = new Map(history.map((m) => [m.ts, m]))
    for (const task of this.tasks.list()) {
      const parent = parents.get(task.thread)
      let due: boolean
      if (parent !== undefined) due = parent.latestReply !== null && (task.lastReplyTs === null || compareTs(parent.latestReply, task.lastReplyTs) > 0)
      else due = task.state === 'open' && this.now() - (this.deepPolled.get(task.thread) ?? 0) >= DEEP_POLL_MS
      if (!due) continue
      if (parent === undefined) this.deepPolled.set(task.thread, this.now())
      await this.readReplies(channel, task.thread, task.lastReplyTs)
    }
    for (const a of [...this.store.state.awaiting]) {
      const latest = parents.get(a.ts)?.latestReply ?? null
      const seen = this.awaitingSeen.get(a.ts) ?? null
      if (latest === null || (seen !== null && compareTs(latest, seen) <= 0)) continue
      await this.readAwaiting(channel, a.ts, seen)
    }
  }

  private async readReplies(channel: string, thread: string, after: string | null): Promise<void> {
    const replies = (await this.api.replies(channel, thread, after)).sort((a, b) => compareTs(a.ts, b.ts))
    for (const r of replies) {
      if (after !== null && compareTs(r.ts, after) <= 0) continue
      if (isOwnerMessage(r, this.store.state.ownerId)) {
        this.lastActivityAt = this.now()
        this.tasks.open(thread, this.tasks.get(thread)?.text ?? '')
        await this.deliver(channel, { thread, ts: r.ts, text: slackToPlain(r.text), kind: 'reply' })
      }
      this.tasks.setLastReply(thread, r.ts)
    }
  }

  private async readAwaiting(channel: string, thread: string, after: string | null): Promise<void> {
    const replies = (await this.api.replies(channel, thread, after)).sort((a, b) => compareTs(a.ts, b.ts))
    for (const r of replies) {
      if (after !== null && compareTs(r.ts, after) <= 0) continue
      this.awaitingSeen.set(thread, r.ts)
      if (!isOwnerMessage(r, this.store.state.ownerId)) continue
      const entry = this.store.state.awaiting.find((a) => a.ts === thread)
      if (entry === undefined) return
      this.store.update({ awaiting: this.store.state.awaiting.filter((a) => a.ts !== thread) })
      const answer = readAnswer(slackToPlain(r.text))
      if (answer.kind === 'no') await this.api.post(channel, 'Dropped.', thread)
      else await this.carryOut(channel, thread, answer.kind === 'yes' ? entry.text : `${entry.text}\n${answer.text}`)
      return
    }
  }

  private emit(): void {
    const status = this.status()
    const shown = JSON.stringify(status)
    if (shown === this.lastShown) return
    this.lastShown = shown
    for (const l of this.listeners) l(status)
  }
}
