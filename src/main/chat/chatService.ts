import { existsSync } from 'node:fs'
import { IPC } from '@shared/api'
import {
  isChatPermissionMode,
  type AsideTurn, type ChatDecision, type ChatEffort, type ChatLifecycle, type ChatModel, type ChatPermissionMode, type ChatState, type TerminalBusy,
} from '@shared/domain/chat'
import type { ResumeConflict } from '@shared/types'
import { chatPush } from '@shared/chatPush'
import { chatActivity, classifyActivity, type ActivityStatus } from '@shared/activity'
import { extractText, type ClaudeOneShot } from '../claude/claudeOneShot'
import { asSessionId, UUID_RE, type AccountId, type SessionId } from '@shared/domain/ids'
import type { LaunchAccounts } from '../accounts/accountService'
import type { PtyManager } from '../pty/ptyManager'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { SessionCatalog } from '../sessions/sessionCatalog'
import type { SessionStore } from '../store/sessionStore'
import type { TerminalService } from '../terminals/terminalService'
import type { WindowAttachments } from '../windows/windowAttachments'
import type { TranscriptService } from '../sessions/transcriptService'
import type { ChatManager } from './chatManager'
import { chatStartMode } from './startMode'

const MAX_ASIDE_CHARS = 4000
const ASIDE_TIMEOUT_MS = 3 * 60_000

/** How much of a side thread goes back with a follow-up: its newest exchanges, each answer capped. */
const ASIDE_EARLIER_TURNS = 6
const ASIDE_EARLIER_ANSWER_CHARS = 4000

/**
 * The side question as asked: about the conversation above, which goes on without it. A follow-up
 * carries the thread's earlier exchanges, which are not in the session (nothing of a side question is
 * saved), so "and the other one?" can be answered.
 */
function asidePrompt(question: string, earlier: readonly AsideTurn[]): string {
  const thread = earlier.slice(-ASIDE_EARLIER_TURNS).map((t) => `Side question: ${t.question}\nYour answer: ${t.answer.slice(0, ASIDE_EARLIER_ANSWER_CHARS)}`)
  return 'This is a side question (/btw) about the conversation above, asked while it carries on. '
    + 'Answer it briefly from what is above. You have no tools here; do not continue, repeat or redo the main task.\n\n'
    + (thread.length > 0 ? `Earlier in this side thread:\n\n${thread.join('\n\n')}\n\n` : '')
    + `Side question: ${question}`
}

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
  accounts: LaunchAccounts
  /** A fresh one-shot `claude` for a side question (`askAside`); one per question, so two can run. */
  aside: () => ClaudeOneShot
  /** The account of a live session changed (`sessionAccountsChanged`). */
  sessionAccountsChanged: () => void
}

/**
 * Chat mode (`main/chat/`), as a service: everything that decides *whether and how* a session
 * runs as a chat, around `ChatManager`, which only holds the processes: take-over of a terminal, the working-directory check, the permission default, the
 * `/clear` adoptions, and who gets to hear about it.
 *
 * Delivery is per window, as for ptys (`WindowAttachments`): a renderer attaches the session its
 * pane shows (`chatAttach`) and gets that chat's `chatChanged` only, instead of every window
 * getting every chat's state about every 120 ms (and only the fields that changed, `ChatPush`). What every window does need to hear —
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
  /**
   * The last state pushed per session, what the next push is diffed against (`chatPush`).
   * Invalidated by: the chat exiting, or `sweep` forgetting it.
   */
  private readonly pushed = new Map<string, ChatState>()

  constructor(private readonly deps: ChatServiceDeps) {}

  /** The state last pushed to windows, not a newer one still coalescing: a window that fetches
   *  mid-stream then holds the `seq` the next delta is computed from. */
  state(sessionId: SessionId): ChatState | null {
    const current = this.deps.chats.state(sessionId)
    return current === null ? null : (this.pushed.get(current.sessionId) ?? current)
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
   * Runs the session under another account from now on. A chat is stopped and started again with
   * the model, mode and effort it had; a terminal's `claude` is killed and the resume command
   * spawned on the same pty id, so the windows showing it keep their tab; with nothing running
   * only the choice is stored.
   */
  async switchAccount(sessionId: SessionId, accountId: AccountId): Promise<void> {
    const { chats, pty, accounts, terminals } = this.deps
    accounts.setAccountOf(sessionId, accountId)
    const launch = chats.launchOf(sessionId)
    if (launch !== null) {
      const live = chats.state(sessionId)
      await chats.stop(sessionId)
      chats.forget(sessionId)
      chats.start(sessionId, launch.cwd, {
        model: live?.model ?? launch.opts.model,
        permissionMode: isChatPermissionMode(live?.permissionMode) ? live.permissionMode : launch.opts.permissionMode,
        effort: live?.effort ?? launch.opts.effort,
      }, accountId)
    } else if (pty.has(sessionId)) {
      await terminals.respawn(sessionId)
    }
    this.deps.sessionAccountsChanged()
  }

  /** The account of every live session: chats, and terminals whose session has an id. */
  liveSessionAccounts(): Record<SessionId, AccountId> {
    const out: Record<SessionId, AccountId> = {}
    for (const [id, process] of this.deps.pty.tuiProcesses()) {
      if (process.accountId !== null && UUID_RE.test(id)) out[asSessionId(id)] = process.accountId
    }
    for (const [id, account] of this.deps.chats.accounts()) out[id] = account
    return out
  }

  /** Whether a live terminal (even one still on a `new:` id) or chat runs under `accountId`. */
  accountInUse(accountId: AccountId): boolean {
    const { pty, chats } = this.deps
    return [...pty.tuiProcesses().values()].some((p) => p.accountId === accountId)
      || chats.accounts().some(([, account]) => account === accountId)
  }

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
    this.deps.attachments.sendTo(this.keysOf(state), IPC.chatChanged, chatPush(this.pushed.get(state.sessionId) ?? null, state))
    if (state.status === 'exited') this.pushed.delete(state.sessionId)
    else this.pushed.set(state.sessionId, state)
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
      this.pushed.delete(state.sessionId)
      chats.forget(state.sessionId)
    }
  }

  /**
   * A side question (`/btw`): answered from the session's conversation so far, by a `claude` of its
   * own that resumes the session as a fork and writes nothing back, with no tools. The session,
   * its file and a chat running in it are untouched, so it can be asked mid-turn. Claude Code's own
   * `/btw` is not available in stream-json mode ("isn't available in this environment", 2.1.302).
   */
  async askAside(sessionId: SessionId, question: string, earlier: readonly AsideTurn[] = []): Promise<string> {
    const text = question.trim()
    if (text === '') throw new Error('Write a question after /btw.')
    if (text.length > MAX_ASIDE_CHARS) throw new Error(`A side question is at most ${String(MAX_ASIDE_CHARS)} characters.`)
    const model = this.deps.chats.state(sessionId)?.model ?? undefined
    const stdout = await this.deps.aside().run({
      prompt: asidePrompt(text, earlier),
      model: model === null ? undefined : model,
      resume: sessionId,
      env: this.deps.accounts.launchEnv(this.deps.accounts.accountOf(sessionId)),
      timeoutMs: ASIDE_TIMEOUT_MS,
      maxStdout: 256 * 1024,
      what: 'an answer',
      tag: 'btw',
    })
    const answer = extractText(stdout)
    if (answer === null) throw new Error('Claude did not answer the side question.')
    return answer
  }
}
