import { randomUUID } from 'node:crypto'
import { UUID_RE } from '@shared/domain/ids'
import { isRecord } from '@shared/guards'
import { errorMessage } from '@shared/errors'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import type { ResidentMessage, ResidentPermissionRequest } from '@shared/domain/residents'
import type { ChatPermissionMode } from '@shared/domain/chat'
import { spawnLoginShell, type LoginShellSpawn, type PipedLoginShell } from '../exec/spawnLoginShell'
import { controlLine, parseLine, permissionReply, permissionRequestOf, userLine, type Line, type PendingPermission } from '../chat/protocol'
import { EMIT_EVERY_MS, INTERRUPT_SETTLE_MS, STDERR_TAIL, STOP_GRACE_MS } from '../chat/chatSession'
import { log } from '../log/logger'
import { activityForTool, clipActivity, permissionSummary, THINKING, WRITING } from './activity'
import type { ResidentSpace } from './residentSpace'

/** What a start needs that the service decides: the MCP config file, the model, the kind's prompt and how it asks. */
export interface ResidentLaunch {
  mcpConfig: string
  model: string
  systemPrompt: string
  permissionMode: ChatPermissionMode
}

export interface ResidentChatDeps {
  space: ResidentSpace
  /** What the user calls it, for "‹name› stopped unexpectedly". */
  name: () => string
  claudeBin: () => string | undefined
  /** The default account's launch environment (`AccountService.launchEnv`). */
  env: () => Record<string, string>
  launch: () => Promise<ResidentLaunch>
  titleOf: (sessionId: string) => string | null
  onMessage: (message: ResidentMessage) => void
  /** The turn started or ended, or what it is doing changed. */
  onActivity: () => void
  spawn?: LoginShellSpawn
}

/**
 * The flags every resident's claude runs with: stream-json both ways, the user's own tools, settings
 * and MCP servers with Apiary's added (and allowed without asking), and every other permission
 * prompt sent over stdio, as chat mode does.
 */
function residentFlags(launch: ResidentLaunch, resume: string | null): string[] {
  return [
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', launch.model,
    '--mcp-config', launch.mcpConfig, '--allowedTools', 'mcp__apiary__*',
    '--permission-mode', launch.permissionMode, '--permission-prompt-tool', 'stdio',
    '--append-system-prompt', launch.systemPrompt,
    ...(resume !== null ? ['--resume', resume] : []),
  ]
}

interface Waiting {
  request: ResidentPermissionRequest
  pending: PendingPermission
}

interface Turn {
  message: ResidentMessage
  /** Text came as stream deltas, so the whole `assistant` message repeats it. */
  streamed: boolean
}

/**
 * One resident's long-lived `claude` (stream-json), and the chat the popup shows. The history is
 * Apiary's own (`history.json`); claude's memory of the conversation is its session, resumed by id.
 */
export class ResidentChat {
  private proc: PipedLoginShell | null = null
  private starting: Promise<PipedLoginShell> | null = null
  private stopping = false
  private buffer = ''
  private stderr = ''
  private messages: ResidentMessage[]
  private turn: Turn | null = null
  private activityText: string | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private interruptId: string | null = null
  /** Tool uses claude is waiting on the user for, by request id, oldest first. */
  private readonly waiting = new Map<string, Waiting>()
  /** When the last turn ended (or the process started): the idle stop counts from here. */
  lastActive = Date.now()

  constructor(private readonly deps: ResidentChatDeps) {
    this.messages = deps.space.loadHistory()
  }

  history(): ResidentMessage[] { return this.messages }
  get running(): boolean { return this.proc !== null || this.starting !== null }
  get busy(): boolean { return this.turn !== null }
  /** Its claude is being started and is not up yet. */
  get launching(): boolean { return this.starting !== null }
  /** What the turn is doing, or null when no turn runs. */
  activity(): string | null { return this.turn === null ? null : this.activityText }
  permissions(): ResidentPermissionRequest[] { return [...this.waiting.values()].map((w) => w.request) }

  /** The resident's own words for what it is doing (`set_activity`), until its next tool call or the turn's end. */
  setOwnActivity(text: string): void {
    if (this.turn !== null) this.setActivity(clipActivity(text))
  }

  /** Allows or denies a waiting tool use, with the reply chat mode sends. An unknown id is ignored: it was answered or cancelled. */
  answerPermission(requestId: string, allow: boolean): void {
    const waiting = this.waiting.get(requestId)
    if (waiting === undefined || this.proc === null) return
    const reply = permissionReply(requestId, allow ? { behavior: 'allow' } : { behavior: 'deny' }, waiting.pending)
    this.waiting.delete(requestId)
    this.proc.child.stdin.write(`${JSON.stringify(reply)}\n`)
    this.deps.onActivity()
  }

  /** Adds a finished assistant message no model wrote (a quick action's output). */
  appendAssistant(text: string): void {
    this.add({ id: randomUUID(), role: 'assistant', text, at: Date.now(), streaming: false })
  }

  /** Adds the person's choice of a quick action, by its label, so the chat shows what was asked. */
  appendAction(label: string): void {
    this.add({ id: randomUUID(), role: 'user', text: label, at: Date.now(), streaming: false, action: true })
  }

  /** An Apiary tool this resident called, as the MCP server saw it: the same words as its tool-use line. */
  toolCalled(name: string, input: unknown): void {
    if (this.turn !== null) this.setActivity(activityForTool(`mcp__apiary__${name}`, input, this.deps.titleOf))
  }

  /** Starts claude ahead of the first message (a warm start); a no-op while it runs. */
  async start(): Promise<void> { await this.ensureRunning() }

  /** `doing` is what the turn says until claude's first tool use or text (a quick action's words). */
  async send(text: string, doing: string | null = null): Promise<void> {
    this.add({ id: randomUUID(), role: 'user', text, at: Date.now(), streaming: false })
    this.turn ??= { message: { id: randomUUID(), role: 'assistant', text: '', at: Date.now(), streaming: true }, streamed: false }
    this.activityText = doing === null ? null : clipActivity(doing)
    this.deps.onActivity()
    try {
      const proc = await this.ensureRunning()
      proc.child.stdin.write(`${JSON.stringify(userLine(text))}\n`)
    } catch (e) {
      this.endTurn(`${this.deps.name()} could not be started: ${errorMessage(e)}`)
    }
  }

  /** Stops the turn; if claude ends nothing (no turn was running), the turn is ended here. */
  interrupt(): void {
    if (this.proc === null || this.turn === null) { if (this.turn !== null) this.endTurn(null); return }
    this.interruptId = randomUUID()
    this.proc.child.stdin.write(`${JSON.stringify(controlLine(this.interruptId, { subtype: 'interrupt' }))}\n`)
  }

  /** Ends the process: SIGTERM, then SIGKILL after a grace period. A running turn ends as it got. */
  async stop(): Promise<void> {
    const starting = this.starting
    if (this.proc === null && starting !== null) await ignoreErrorsAsync(() => starting, 'a start that failed left no process to stop')
    const proc = this.proc
    if (proc === null) return
    this.stopping = true
    proc.child.stdin.end()
    await proc.stop(STOP_GRACE_MS)
  }

  /** Forgets the conversation: the process, the visible history and claude's session id. */
  async clear(): Promise<void> {
    await this.stop()
    this.turn = null
    this.messages = []
    this.deps.space.saveHistory([])
    this.deps.space.setClaudeSessionId(null)
    this.deps.onActivity()
  }

  private ensureRunning(): Promise<PipedLoginShell> {
    if (this.proc !== null) return Promise.resolve(this.proc)
    this.starting ??= this.spawn().finally(() => { this.starting = null })
    return this.starting
  }

  private async spawn(): Promise<PipedLoginShell> {
    const launch = await this.deps.launch()
    this.deps.space.ensure()
    const stored = this.deps.space.claudeSessionId()
    const resume = stored !== null && UUID_RE.test(stored) ? stored : null
    const proc = spawnLoginShell({
      command: { bin: this.deps.claudeBin() ?? 'claude', flags: residentFlags(launch, resume) },
      cwd: this.deps.space.dir,
      extraEnv: this.deps.env(),
    }, this.deps.spawn)
    this.proc = proc
    this.stopping = false
    this.buffer = ''
    this.stderr = ''
    this.lastActive = Date.now()
    proc.child.stdout.setEncoding('utf8')
    proc.child.stdout.on('data', (chunk: string) => { this.read(chunk) })
    proc.child.stderr.setEncoding('utf8')
    proc.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL) })
    proc.child.stdin.on('error', () => {})
    void proc.exited.then(({ code, signal, error }) => { this.exited(proc, error?.message ?? (this.stderrReason() || `exit ${String(code ?? signal)}`)) })
    log.info('residents', 'started', { pid: proc.child.pid ?? null, resumed: resume !== null })
    return proc
  }

  private stderrReason(): string {
    return this.stderr.trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? ''
  }

  private exited(proc: PipedLoginShell, reason: string): void {
    if (this.proc !== proc) return
    this.proc = null
    if (this.waiting.size > 0) { this.waiting.clear(); this.deps.onActivity() }
    if (this.stopping) {
      if (this.turn !== null) this.endTurn(null)
      return
    }
    log.warn('residents', 'exited', { reason })
    if (this.turn !== null) this.endTurn(`${this.deps.name()} stopped unexpectedly: ${reason}`)
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = parseLine(this.buffer.slice(0, newline))
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== null) this.consume(line)
    }
  }

  private consume(line: Line): void {
    if (typeof line.session_id === 'string' && UUID_RE.test(line.session_id) && (line.type === 'result' || (line.type === 'system' && line.subtype === 'init'))) {
      if (this.deps.space.claudeSessionId() !== line.session_id) this.deps.space.setClaudeSessionId(line.session_id)
    }
    if (line.type === 'control_response') { this.settleInterrupt(line); return }
    if (line.type === 'control_request') { this.permissionAsked(line); return }
    if (line.type === 'control_cancel_request') {
      if (typeof line.request_id === 'string' && this.waiting.delete(line.request_id)) this.deps.onActivity()
      return
    }
    if (line.type === 'stream_event') { this.streamed(line.event); return }
    // A subagent's messages carry the tool use they belong to; only the resident's own are its answer.
    if (line.type === 'assistant' && (line.parent_tool_use_id === null || line.parent_tool_use_id === undefined)) { this.assistant(line.message); return }
    if (line.type === 'result') this.endTurn(this.turn?.message.text === '' && typeof line.result === 'string' ? line.result : null)
  }

  private streamed(event: unknown): void {
    const turn = this.turn
    if (turn === null || !isRecord(event)) return
    const block = event.type === 'content_block_start' && isRecord(event.content_block) ? event.content_block.type : null
    if (block === 'thinking') this.setActivity(THINKING)
    if (block === 'text' && turn.message.text !== '') this.append('\n\n')
    if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
      turn.streamed = true
      this.append(event.delta.text)
      this.setActivity(WRITING)
    }
  }

  private assistant(message: unknown): void {
    const turn = this.turn
    if (turn === null || !isRecord(message) || !Array.isArray(message.content)) return
    for (const block of message.content) {
      if (!isRecord(block)) continue
      if (block.type === 'tool_use' && typeof block.name === 'string') this.setActivity(activityForTool(block.name, block.input, this.deps.titleOf))
      if (block.type === 'text' && typeof block.text === 'string' && !turn.streamed) {
        this.append(turn.message.text === '' ? block.text : `\n\n${block.text}`)
      }
    }
    turn.streamed = false
  }

  private permissionAsked(line: Line): void {
    const asked = permissionRequestOf(line)
    if (asked === null || this.waiting.has(asked.request.requestId)) return
    const { requestId, toolName } = asked.request
    this.waiting.set(requestId, { request: { requestId, tool: toolName, summary: permissionSummary(toolName, asked.request.input) }, pending: asked.pending })
    this.deps.onActivity()
  }

  private settleInterrupt(line: Line): void {
    const response = isRecord(line.response) ? line.response : {}
    if (this.interruptId === null || response.request_id !== this.interruptId) return
    this.interruptId = null
    const turn = this.turn
    setTimeout(() => { if (this.turn === turn && turn !== null) this.endTurn(null) }, INTERRUPT_SETTLE_MS)
  }

  private add(message: ResidentMessage): void {
    this.messages = [...this.messages, message]
    this.deps.space.saveHistory(this.messages)
    this.deps.onMessage(message)
  }

  private setActivity(text: string): void {
    if (this.activityText === text) return
    this.activityText = text
    this.deps.onActivity()
  }

  private append(text: string): void {
    const turn = this.turn
    if (turn === null) return
    turn.message = { ...turn.message, text: turn.message.text + text }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      if (this.turn === turn) this.deps.onMessage(turn.message)
    }, EMIT_EVERY_MS)
  }

  /** Ends the running turn: its message is saved as it got, with `note` (an error) when it has no text. */
  private endTurn(note: string | null): void {
    const turn = this.turn
    if (turn === null) return
    this.turn = null
    this.activityText = null
    if (this.emitTimer !== null) { clearTimeout(this.emitTimer); this.emitTimer = null }
    const text = note !== null && turn.message.text !== '' ? `${turn.message.text}\n\n${note}` : turn.message.text || (note ?? '')
    this.lastActive = Date.now()
    if (text !== '') {
      const done: ResidentMessage = { ...turn.message, text, streaming: false }
      this.messages = [...this.messages, done]
      this.deps.space.saveHistory(this.messages)
      this.deps.onMessage(done)
    }
    this.deps.onActivity()
  }
}
