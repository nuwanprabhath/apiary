import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ChatDecision, ChatEffort, ChatModel, ChatPermissionMode, ChatState } from '@shared/domain/chat'
import { buildChatCommand, loginShell } from '../pty/resumeCommand'
import { childEnv } from '../pty/childEnv'
import { log } from '../log/logger'
import { ChatSession } from './chatSession'

export type SpawnChat = (command: string, cwd: string) => ChildProcessWithoutNullStreams

export interface ChatManagerDeps {
  claudeBin: () => string | undefined
  onChange: (state: ChatState) => void
  /** Injectable for tests; the default runs `command` in a login shell, as terminals do. */
  spawn?: SpawnChat
}

const defaultSpawn: SpawnChat = (command, cwd) => nodeSpawn(loginShell(), ['-l', '-c', command], {
  cwd,
  env: childEnv(process.env),
  stdio: 'pipe',
})

/**
 * Every session running in chat mode (see `shared/domain/chat.ts`), by session id. A session is
 * never in chat mode and in a terminal at once — two `claude` processes on one session would both
 * append to its JSONL — so `AppService` stops one before starting the other.
 */
export class ChatManager {
  private readonly sessions = new Map<string, ChatSession>()

  constructor(private readonly deps: ChatManagerDeps) {}

  /** Whether `sessionId` has a chat process that is still running. */
  has(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.running === true
  }

  state(sessionId: string): ChatState | null {
    return this.sessions.get(sessionId)?.current ?? null
  }

  start(sessionId: string, cwd: string, opts: { model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort } = {}): ChatState {
    const existing = this.sessions.get(sessionId)
    if (existing?.running === true) return existing.current
    const command = buildChatCommand(sessionId, { claudeBin: this.deps.claudeBin(), ...opts })
    const child = (this.deps.spawn ?? defaultSpawn)(command, cwd)
    const session = new ChatSession(sessionId, child, (state) => {
      if (state.status === 'exited' && state.error !== null) log.warn('chat', 'exited', { sessionId: state.sessionId, error: state.error })
      this.deps.onChange(state)
    }, (from, to) => {
      // Filed under the session it now writes to, so `has`, `resume` and conflicts see it there.
      this.sessions.delete(from)
      this.sessions.set(to, session)
      log.info('chat', 'moved to a new session', { from, to })
    })
    this.sessions.set(sessionId, session)
    log.info('chat', 'started', { sessionId, pid: child.pid ?? null })
    this.deps.onChange(session.current)
    return session.current
  }

  send(sessionId: string, text: string): void { this.require(sessionId).send(text) }
  interrupt(sessionId: string): void { this.require(sessionId).interrupt() }
  respond(sessionId: string, requestId: string, decision: ChatDecision): void { this.require(sessionId).respond(requestId, decision) }
  setPermissionMode(sessionId: string, mode: ChatPermissionMode): void { this.require(sessionId).setPermissionMode(mode) }
  setModel(sessionId: string, model: ChatModel): void { this.require(sessionId).setModel(model) }
  setEffort(sessionId: string, effort: ChatEffort): void { this.require(sessionId).setEffort(effort) }

  async stop(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()))
  }

  private require(sessionId: string): ChatSession {
    const session = this.sessions.get(sessionId)
    if (session?.running !== true) throw new Error('This session is not running as a chat')
    return session
  }
}
