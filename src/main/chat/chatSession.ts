import { randomUUID } from 'node:crypto'
import { asSessionId, UUID_RE, type SessionId } from '@shared/domain/ids'
import {
  emptyChatState, type ChatDecision, type ChatEffort, type ChatModel, type ChatPermissionMode, type ChatState,
} from '@shared/domain/chat'
import type { PipedLoginShell } from '../exec/spawnLoginShell'
import { fireAndForget } from '../log/fireAndForget'
import {
  appliedOf, commandsOf, contextUsageOf, modelsOf, controlLine, parseLine, permissionReply, permissionRequestOf, reduce, userLine, type Line, type PendingPermission,
} from './protocol'

/** How often a burst of streamed text reaches the window: often enough to read as live. */
const EMIT_EVERY_MS = 40
/** How much of stderr is kept, to say why a process stopped. */
const STDERR_TAIL = 2000
/** How long a stopped process gets to exit before it is killed outright. */
const STOP_GRACE_MS = 3000

/**
 * One session's `claude` process in chat mode. Turns its stdout into `ChatState` (protocol.ts does
 * the reading) and the window's actions into lines on its stdin.
 */
export class ChatSession {
  private state: ChatState
  private readonly pending = new Map<string, PendingPermission>()
  private buffer = ''
  private stderr = ''
  private emitTimer: NodeJS.Timeout | null = null
  /** Set by `stop()`: an exit we asked for is never an error, whatever code claude exits with
   *  (it exits 143 on SIGTERM rather than dying of the signal). */
  private stopping = false
  private readonly exited: Promise<void>
  /** Our own control requests waiting for claude's `control_response`, by request id. */
  private readonly awaiting = new Map<string, (response: Line) => void>()

  constructor(
    public sessionId: SessionId,
    private readonly proc: PipedLoginShell,
    private readonly onChange: (state: ChatState) => void,
    /** Claude moved the chat onto a new session (`/clear`); the manager re-files it. */
    private readonly onRekey: (from: SessionId, to: SessionId) => void = () => {},
  ) {
    // Ready to take a message the moment it exists: stdin is buffered until claude reads it.
    this.state = { ...emptyChatState(sessionId), status: 'idle' }
    const child = proc.child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { this.read(chunk) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL) })
    // A write after the process has gone is reported here rather than thrown at the caller.
    child.stdin.on('error', () => {})
    // claude's model list (what the picker offers) comes in its answer to `initialize`.
    // `request` never rejects (it resolves an error line instead), so what `fireAndForget` can log
    // here is the handler itself throwing.
    fireAndForget(this.request({ subtype: 'initialize' }).then((r) => {
      const models = modelsOf(r.response)
      const commands = commandsOf(r.response)
      this.update({ ...this.state, models: models ?? this.state.models, commands: commands ?? this.state.commands }, true)
      // The ring shows from the start: a resumed session's context is already full of it.
      this.refreshContext()
    }), 'chat')
    // `exited` settles on the process ending *or* failing to start (`spawnLoginShell`), so a chat
    // whose shell cannot be run still ends as `exited` rather than leaving `stop()` waiting (MAIN-19).
    this.exited = proc.exited.then(({ code, signal, error }) => {
      const clean = error === undefined && (this.stopping || code === 0)
      this.update({
        ...this.state,
        status: 'exited',
        streaming: null,
        turnStartedAt: null,
        permissions: [],
        error: clean ? null : (error !== undefined
          ? `claude could not be started: ${error.message}`
          : (this.stderr.trim().split('\n').slice(-3).join('\n') || `claude exited (${String(code ?? signal)})`)),
      }, true)
      for (const reject of this.awaiting.values()) reject({ subtype: 'error', error: 'claude exited' })
      this.awaiting.clear()
    })
  }

  /** Sends a control request and resolves with claude's answer (`response`, `subtype`, `error`). */
  private request(request: Line): Promise<Line> {
    const id = randomUUID()
    return new Promise((resolve) => {
      this.awaiting.set(id, resolve)
      try {
        this.write(controlLine(id, request))
      } catch {
        this.awaiting.delete(id)
        resolve({ subtype: 'error', error: 'This chat has stopped' })
      }
    })
  }

  /** Re-reads which model and effort are really in effect — after init, and after any change. */
  private refreshApplied(): void {
    fireAndForget(this.request({ subtype: 'get_settings' }).then((r) => {
      if (r.subtype !== 'success') return
      const { model, effort } = appliedOf(r.response)
      this.update({ ...this.state, model: model ?? this.state.model, effort }, true)
    }), 'chat')
  }

  get current(): ChatState { return this.state }
  get running(): boolean { return this.state.status !== 'exited' }

  send(text: string): void {
    this.write(userLine(text))
    this.update({
      ...this.state,
      status: 'busy',
      error: null,
      turnStartedAt: this.state.turnStartedAt ?? Date.now(),
      queued: [...this.state.queued, { id: randomUUID(), text, sentAt: Date.now() }],
    }, true)
  }

  /** Re-reads how full the context is — at the start, and after every turn. The window's size is
   *  only otherwise known from a turn's `result`, which a long first turn keeps the ring waiting for. */
  private refreshContext(): void {
    fireAndForget(this.request({ subtype: 'get_context_usage' }).then((r) => {
      const usage = r.subtype === 'success' ? contextUsageOf(r.response) : null
      if (usage !== null) this.update({ ...this.state, contextUsed: usage.used, contextWindow: usage.window }, true)
    }), 'chat')
  }

  interrupt(): void { this.write(controlLine(randomUUID(), { subtype: 'interrupt' })) }

  setPermissionMode(mode: ChatPermissionMode): void {
    this.write(controlLine(randomUUID(), { subtype: 'set_permission_mode', mode }))
    this.update({ ...this.state, permissionMode: mode }, true)
  }

  setModel(model: ChatModel): void {
    void this.request({ subtype: 'set_model', model }).then(() => { this.refreshApplied() })
  }

  setEffort(effort: ChatEffort): void {
    void this.request({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } }).then(() => { this.refreshApplied() })
  }

  respond(requestId: string, decision: ChatDecision): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    this.pending.delete(requestId)
    this.write(permissionReply(requestId, decision, pending))
    this.update({ ...this.state, permissions: this.state.permissions.filter((p) => p.requestId !== requestId) }, true)
  }

  /** Ends the process: SIGTERM, then SIGKILL if it has not gone after a grace period. */
  async stop(): Promise<void> {
    if (!this.running) return
    this.stopping = true
    this.proc.child.stdin.end()
    await this.proc.stop(STOP_GRACE_MS)
    await this.exited
  }

  private write(line: Line): void {
    if (!this.running) throw new Error('This chat has stopped')
    this.proc.child.stdin.write(`${JSON.stringify(line)}\n`)
  }

  private read(chunk: string): void {
    this.buffer += chunk
    let next = this.state
    let urgent = false
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const event = parseLine(this.buffer.slice(0, newline))
      this.buffer = this.buffer.slice(newline + 1)
      if (event === null) continue
      if (event.type === 'control_response') {
        const response = event.response as Line | undefined
        const id = typeof response?.request_id === 'string' ? response.request_id : null
        const waiter = id !== null ? this.awaiting.get(id) : undefined
        if (waiter !== undefined && id !== null) { this.awaiting.delete(id); waiter(response ?? {}) }
        continue
      }
      if (event.type === 'system' && event.subtype === 'init') {
        // `/clear` starts a new conversation in the same process: claude says so by initialising
        // under a new session id. Everything after it belongs to that session, not this one.
        if (typeof event.session_id === 'string' && UUID_RE.test(event.session_id) && event.session_id !== this.sessionId) {
          const from = this.sessionId
          const to = asSessionId(event.session_id)
          this.sessionId = to
          next = { ...next, sessionId: to, previousSessionId: from, live: [], thoughts: {}, contextUsed: null }
          this.onRekey(from, to)
          urgent = true
        }
        this.refreshApplied()
        this.refreshContext()
      }
      const prompt = permissionRequestOf(event)
      if (prompt !== null) this.pending.set(prompt.request.requestId, prompt.pending)
      if (event.type === 'control_cancel_request' && typeof event.request_id === 'string') this.pending.delete(event.request_id)
      if (event.type === 'result') this.pending.clear()
      // A permission prompt or the end of a turn is shown at once; streamed text can wait a frame.
      if (prompt !== null || event.type === 'result' || event.type === 'system') urgent = true
      next = reduce(next, event)
      if (event.type === 'result') this.refreshContext()
    }
    if (next !== this.state) this.update(next, urgent)
  }

  /**
   * The one place the state changes. `exited` is final: a reply that was in flight when the
   * process ended (`initialize`, `get_settings`) settles afterwards and used to re-emit the
   * exited state, so the chat looked like it ended twice. Once exited, nothing is emitted again.
   */
  private update(next: ChatState, now: boolean): void {
    if (this.state.status === 'exited') return
    this.state = next
    if (now) {
      if (this.emitTimer !== null) { clearTimeout(this.emitTimer); this.emitTimer = null }
      this.onChange(this.state)
      return
    }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null
      this.onChange(this.state)
    }, EMIT_EVERY_MS)
  }
}
