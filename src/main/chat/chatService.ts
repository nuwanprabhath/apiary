import { existsSync } from 'node:fs'
import { IPC } from '@shared/api'
import type {
  ChatDecision, ChatEffort, ChatLifecycle, ChatModel, ChatPermissionMode, ChatState, TerminalBusy,
} from '@shared/domain/chat'
import type { ResumeConflict } from '@shared/types'
import { chatActivity, classifyActivity, type ActivityStatus } from '@shared/activity'
import type { SessionId } from '@shared/domain/ids'
import type { PtyManager } from '../pty/ptyManager'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { SessionCatalog } from '../sessions/sessionCatalog'
import type { SessionStore } from '../store/sessionStore'
import type { TerminalService } from '../terminals/terminalService'
import type { WindowAttachments } from '../windows/windowAttachments'
import type { TranscriptService } from '../sessions/transcriptService'
import type { ChatManager } from './chatManager'
import { chatStartMode } from './startMode'

export interface ChatServiceDeps {
  /** Built in the container with `onChange` pointing back at `ChatService.onChanged`. */
  chats: ChatManager
  pty: PtyManager
  resolver: SessionResolver
  store: SessionStore
  terminals: TerminalService
  catalog: SessionCatalog
  /** What a terminal's claude has in flight, read from the session file. */
  transcripts: TranscriptService
  /** Claude Code's config root, for its settings (`chatStartMode`). */
  configRoot: string
  /** Which windows show which session's chat; `chatChanged` goes only to those. */
  attachments: WindowAttachments
  /** Tells every window, shown or not, that a chat started, moved or ended (`chatLifecycle`). */
  announce: (change: ChatLifecycle) => void
  /** Asks the windows for the Active section again: a chat's activity has moved (`activeTabsChanged`). */
  activityChanged: () => void
}

/**
 * Chat mode (`main/chat/`), as a service: everything that decides *whether and how* a session
 * runs as a chat, around `ChatManager`, which only holds the processes. Moved out of `AppService`
 * (MAIN-14): take-over of a terminal, the working-directory check, the permission default, the
 * `/clear` adoptions, and who gets to hear about it.
 *
 * Delivery is per window, as for ptys (`WindowAttachments`): a renderer attaches the session its
 * pane shows (`chatAttach`) and gets that chat's `chatChanged` only, instead of every window
 * getting every chat's full state about every 40 ms. What every window does need to hear —
 * a chat took the terminal over, or `/clear` moved it onto a new session — travels separately as
 * the rare, tiny `chatLifecycle`.
 *
 * An exited chat is dropped from the manager once no window shows it; while one does, its last
 * state stays available to that window (a reload asks for it again).
 */
export class ChatService {
  /**
   * Sessions a chat moved onto with `/clear`, waiting for their file to be scanned. They belong in
   * the library as much as the session they continue — the window's tab follows the chat onto
   * them — but a folder without auto-import would otherwise leave them undiscovered-only.
   */
  private readonly adoptions = new Set<string>()
  /** Adopted already: every later state of that chat still names the session it left, and an
   *  adoption must not undo the user archiving the session afterwards. */
  private readonly adopted = new Set<string>()
  /** The last lifecycle announced (`status|previousSessionId`) and activity seen, per session, so a
   *  stream of identical states announces nothing. Kept after the chat is forgotten (`sweep`): a late
   *  state of that run must not announce its end a second time, and the next run's `running`
   *  replaces the entry. */
  private readonly announced = new Map<string, { lifecycle: string; activity: ActivityStatus }>()

  constructor(private readonly deps: ChatServiceDeps) {}

  state(sessionId: SessionId): ChatState | null {
    return this.deps.chats.state(sessionId)
  }

  /**
   * Starts `sessionId` in chat mode, or returns the chat already running. A session running in a
   * terminal is refused unless `takeOver` — then that terminal's `claude` is stopped first, and
   * the chat resumes the same conversation.
   */
  async start(
    sessionId: SessionId,
    opts: { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort },
  ): Promise<ChatState> {
    const { chats, pty, resolver, configRoot } = this.deps
    const existing = chats.state(sessionId)
    if (existing !== null && existing.status !== 'exited') return existing
    if (pty.has(sessionId)) {
      if (!opts.takeOver) throw new Error('This session is running in its terminal')
      await pty.killAndWait(sessionId)
    }
    const session = resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    const permissionMode = opts.permissionMode ?? chatStartMode(configRoot, cwd)
    return chats.start(sessionId, cwd, { model: opts.model, permissionMode, effort: opts.effort })
  }

  send(sessionId: SessionId, text: string): void { this.deps.chats.send(sessionId, text) }
  interrupt(sessionId: SessionId): void { this.deps.chats.interrupt(sessionId) }
  sendNow(sessionId: SessionId, queuedId: string): void { this.deps.chats.sendNow(sessionId, queuedId) }
  respond(sessionId: SessionId, requestId: string, decision: ChatDecision): void {
    this.deps.chats.respond(sessionId, requestId, decision)
  }
  setPermissionMode(sessionId: SessionId, mode: ChatPermissionMode): void { this.deps.chats.setPermissionMode(sessionId, mode) }
  setModel(sessionId: SessionId, model: ChatModel): void { this.deps.chats.setModel(sessionId, model) }
  setEffort(sessionId: SessionId, effort: ChatEffort): void { this.deps.chats.setEffort(sessionId, effort) }
  async stop(sessionId: SessionId): Promise<void> { await this.deps.chats.stop(sessionId) }
  async stopAll(): Promise<void> { await this.deps.chats.stopAll() }

  /**
   * Opens the session in its terminal. One process per session: two `claude`s on one session
   * would both append to its JSONL, so a running chat is stopped first.
   */
  async resumeInTerminal(sessionId: SessionId): Promise<void> {
    if (this.deps.chats.has(sessionId)) await this.deps.chats.stop(sessionId)
    return this.deps.terminals.resume(sessionId)
  }

  async checkConflict(sessionId: SessionId): Promise<ResumeConflict | null> {
    // A chat this app is running is not "someone else's" process: opening the session in a
    // terminal stops it (see `resumeInTerminal`), so it must not raise the conflict dialog.
    if (this.deps.chats.has(sessionId)) return null
    return this.deps.catalog.checkConflict(sessionId)
  }

  /**
   * Whether stopping the session's terminal would cost anything: Claude mid-turn (read from the
   * rendered screen, as the activity dots are), or background tasks it started that have not
   * reported back (read from the session file) — they are its children and die with it. The
   * chat takes over only a terminal with neither.
   */
  async terminalBusy(sessionId: SessionId): Promise<TerminalBusy> {
    const { pty, transcripts } = this.deps
    if (!pty.has(sessionId)) return { busy: false, backgroundTasks: 0 }
    const status = classifyActivity(pty.screen(sessionId), pty.lastOutputAt(sessionId), Date.now(), true)
    return { busy: status !== 'idle', backgroundTasks: await transcripts.runningBackgroundTasks(sessionId) }
  }

  /** Makes the sessions chats moved onto part of the library, once their file has been scanned. */
  adoptSessions(): void {
    for (const id of [...this.adoptions]) {
      if (this.deps.store.getSession(id) === null) continue
      this.deps.store.setImported([id], true)
      this.adoptions.delete(id)
      this.adopted.add(id)
    }
  }

  /** A window's pane shows this session: its chat updates go to that window from now on. */
  attach(webContentsId: number, sessionId: SessionId): void {
    this.deps.attachments.attach(webContentsId, sessionId)
  }

  detach(webContentsId: number, sessionId: SessionId): void {
    this.deps.attachments.detach(webContentsId, sessionId)
    this.sweep()
  }

  /** A window closed or reloaded. */
  detachWindow(webContentsId: number): void {
    this.deps.attachments.detachWindow(webContentsId)
    this.sweep()
  }

  /** `ChatManager`'s `onChange`: every state a chat reaches. */
  onChanged(state: ChatState): void {
    if (state.previousSessionId !== null && !this.adopted.has(state.sessionId)) this.adoptions.add(state.sessionId)
    // Windows showing the session it is now on, and those still on the one `/clear` left: they
    // follow the chat until their tab does (`useChatTakeover`).
    this.deps.attachments.sendTo(this.keysOf(state), IPC.chatChanged, state)
    this.observe(state)
    if (state.status === 'exited') this.sweep()
  }

  private keysOf(state: ChatState): string[] {
    return state.previousSessionId === null ? [state.sessionId] : [state.sessionId, state.previousSessionId]
  }

  private observe(state: ChatState): void {
    const lifecycle = `${state.status === 'exited' ? 'exited' : 'running'}|${state.previousSessionId ?? ''}`
    const activity = chatActivity(state)
    const seen = this.announced.get(state.sessionId)
    this.announced.set(state.sessionId, { lifecycle, activity })
    if (seen?.lifecycle !== lifecycle) {
      this.deps.announce({
        sessionId: state.sessionId, previousSessionId: state.previousSessionId, running: state.status !== 'exited',
      })
    }
    if (seen?.activity !== activity) this.deps.activityChanged()
  }

  /** Drops every exited chat that no window shows any more (and what is remembered about it). */
  private sweep(): void {
    const { chats, attachments } = this.deps
    for (const state of chats.exitedStates()) {
      if (this.keysOf(state).some((key) => attachments.isAttached(key))) continue
      chats.forget(state.sessionId)
    }
  }
}
