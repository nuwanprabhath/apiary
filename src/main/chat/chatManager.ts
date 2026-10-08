import type { ChatDecision, ChatEffort, ChatModel, ChatPermissionMode, ChatState } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { buildChatCommand } from '../pty/resumeCommand'
import { spawnLoginShell, type LoginShellSpawn } from '../exec/spawnLoginShell'
import { log } from '../log/logger'
import { ChatSession } from './chatSession'

/** The `child_process.spawn` seam `spawnLoginShell` takes — a fake child in tests. */
export type SpawnChat = LoginShellSpawn

export interface ChatManagerDeps {
  claudeBin: () => string | undefined
  onChange: (state: ChatState) => void
  /** Injectable for tests; the chat runs `command` in a login shell (`spawnLoginShell`), as terminals do. */
  spawn?: SpawnChat
}

/**
 * Every session running in chat mode (see `shared/domain/chat.ts`), by session id. A session is
 * never in chat mode and in a terminal at once — two `claude` processes on one session would both
 * append to its JSONL — so `ChatService` stops one before starting the other.
 *
 * An exited session stays here (its last state, with the error that ended it) until `forget`: the
 * window still showing it asks `state` for it. `ChatService` forgets it once no window does.
 */
export class ChatManager {
  private readonly sessions = new Map<SessionId, ChatSession>()

  constructor(private readonly deps: ChatManagerDeps) {}

  /** Whether `sessionId` has a chat process that is still running. */
  has(sessionId: SessionId): boolean {
    return this.sessions.get(sessionId)?.running === true
  }

  state(sessionId: SessionId): ChatState | null {
    return this.sessions.get(sessionId)?.current ?? null
  }

  /** The last state of every session whose process has ended and that has not been forgotten. */
  exitedStates(): ChatState[] {
    return [...this.sessions.values()].filter((s) => !s.running).map((s) => s.current)
  }

  /** Drops an exited session; a running one is left alone. */
  forget(sessionId: SessionId): void {
    if (this.sessions.get(sessionId)?.running === false) this.sessions.delete(sessionId)
  }

  start(sessionId: SessionId, cwd: string, opts: { model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort } = {}): ChatState {
    const existing = this.sessions.get(sessionId)
    if (existing?.running === true) return existing.current
    const command = buildChatCommand(sessionId, { claudeBin: this.deps.claudeBin(), ...opts })
    const proc = spawnLoginShell({ command, cwd }, this.deps.spawn)
    const session = new ChatSession(sessionId, proc, (state) => {
      if (state.status === 'exited' && state.error !== null) log.warn('chat', 'exited', { sessionId: state.sessionId, error: state.error })
      this.deps.onChange(state)
    }, (from, to) => {
      // Filed under the session it now writes to, so `has`, `resume` and conflicts see it there.
      this.sessions.delete(from)
      this.sessions.set(to, session)
      log.info('chat', 'moved to a new session', { from, to })
    })
    this.sessions.set(sessionId, session)
    log.info('chat', 'started', { sessionId, pid: proc.child.pid ?? null })
    this.deps.onChange(session.current)
    return session.current
  }

  send(sessionId: SessionId, text: string): void { this.require(sessionId).send(text) }
  interrupt(sessionId: SessionId): void { this.require(sessionId).interrupt() }
  respond(sessionId: SessionId, requestId: string, decision: ChatDecision): void { this.require(sessionId).respond(requestId, decision) }
  setPermissionMode(sessionId: SessionId, mode: ChatPermissionMode): void { this.require(sessionId).setPermissionMode(mode) }
  setModel(sessionId: SessionId, model: ChatModel): void { this.require(sessionId).setModel(model) }
  setEffort(sessionId: SessionId, effort: ChatEffort): void { this.require(sessionId).setEffort(effort) }

  async stop(sessionId: SessionId): Promise<void> {
    await this.sessions.get(sessionId)?.stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()))
  }

  private require(sessionId: SessionId): ChatSession {
    const session = this.sessions.get(sessionId)
    if (session?.running !== true) throw new Error('This session is not running as a chat')
    return session
  }
}
