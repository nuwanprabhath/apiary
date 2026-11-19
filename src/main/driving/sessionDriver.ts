import { createHash } from 'node:crypto'
import type { ChatDecision, ChatPermissionRequest, ChatState, TerminalBusy } from '@shared/domain/chat'
import type { WorktreeCreateRequest } from '@shared/domain/git'
import type { SessionId } from '@shared/domain/ids'
import { errorMessage } from '@shared/errors'
import type { ChatService } from '../chat/chatService'
import { log } from '../log/logger'

export interface DriveFolder {
  id: string
  /** The folder's name as the sidebar shows it. */
  name: string
  branch: string | null
  isRepo: boolean
  /** For a worktree: the name of the repository it belongs to. */
  worktreeOf: string | null
}

export type SessionEvent =
  /** A message that waited for the session's terminal was delivered. */
  | { kind: 'delivered'; sessionId: SessionId; title: string }
  /** A turn ended. `text` is its final assistant text ('' when it ended with none); `backgroundTasks` how many tasks it left running. */
  | { kind: 'turn-ended'; sessionId: SessionId; title: string; text: string; backgroundTasks: number; interrupted: boolean }
  /** The session asks permission, or asks a question (`request.toolName === 'AskUserQuestion'`). */
  | { kind: 'permission'; sessionId: SessionId; title: string; request: ChatPermissionRequest }
  /** A request went away without the driver answering it (answered at the desk, or cancelled). */
  | { kind: 'permission-gone'; sessionId: SessionId; requestId: string }
  /** Its chat ended, or a waiting message was given up on. */
  | { kind: 'stopped'; sessionId: SessionId; title: string; reason: string | null }
  /** The chat moved to a new session (`/clear`). */
  | { kind: 'moved'; sessionId: SessionId; from: SessionId }

/** A folder as main knows it; the driver turns `path` into an opaque id and never hands the path out. */
export interface FolderSource {
  path: string
  name: string
  branch: string | null
  isRepo: boolean
  worktreeOf: string | null
}

export interface SessionDriverDeps {
  chat: Pick<ChatService, 'start' | 'startNew' | 'send' | 'interrupt' | 'respond' | 'state' | 'terminalBusy' | 'onState'>
  /** The session the store knows (not archived), with the title the sidebar shows; null otherwise. */
  session: (id: SessionId) => { title: string } | null
  /** Every project the store knows that still exists on disk. */
  folders: () => FolderSource[]
  /** `GitService.createWorktree`: the new worktree's path, after the dialog's own checks. */
  createWorktree: (folderPath: string, request: WorktreeCreateRequest) => Promise<string>
  /** A new worktree as a folder (its path is main's own, from git). */
  describeFolder: (path: string, repoName: string) => FolderSource
  /** Shows the session's tab; a failure is logged by the driver. */
  openSession: (id: SessionId) => void
  /** Asks the catalog for a scoped refresh, so a new session's file is scanned. */
  refresh: () => Promise<void>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const MAX_DRIVEN_MESSAGE_CHARS = 20_000
const MAX_EVENT_TEXT = 6000
const TERMINAL_CHECK_MS = 5000
const TERMINAL_GIVE_UP_MS = 30 * 60_000
const KNOWN_WAIT_MS = 60_000

interface Watch {
  busy: boolean
  /** The driver's `interrupt` was sent during the turn in progress. */
  interrupting: boolean
  since: number | null
  /** Request ids open now, and those the driver answered (their going away is not news). */
  open: Set<string>
  answered: Set<string>
  stopped: boolean
}

const folderId = (path: string): string => createHash('sha256').update(path).digest('hex').slice(0, 12)

function finalText(state: ChatState): string {
  for (let i = state.live.length - 1; i >= 0; i--) {
    const message = state.live[i]
    if (message === undefined || message.isSidechain) continue
    if (message.role === 'user') return ''
    const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()
    if (text !== '') return text
  }
  return ''
}

const cutEventText = (text: string): string => (text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1)}…` : text)

/**
 * Acts on sessions for something that is not at the keyboard (Regent): sends a message, starts a
 * session, interrupts, answers a permission request, and says what watched sessions do. A driven
 * session always runs as a chat. Folders are named by opaque ids: no method takes or returns a path.
 */
export class SessionDriver {
  private readonly watches = new Map<SessionId, Watch>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(private readonly deps: SessionDriverDeps) {
    this.unsubscribe = deps.chat.onState((state) => { this.heard(state) })
  }

  folders(): DriveFolder[] {
    return this.deps.folders().map((f) => this.toDrive(f))
  }

  async send(sessionId: SessionId, text: string): Promise<'sent' | 'waiting'> {
    checkText(text)
    this.requireSession(sessionId)
    const live = this.deps.chat.state(sessionId)
    if (live !== null && live.status !== 'exited') {
      this.deps.chat.send(sessionId, text)
      this.open(sessionId)
      return 'sent'
    }
    if (!(await this.deps.chat.terminalBusy(sessionId)).busy) {
      await this.deliver(sessionId, text)
      return 'sent'
    }
    this.waitForTerminal(sessionId, text)
    return 'waiting'
  }

  async startSession(folderId_: string, text: string, worktree?: WorktreeCreateRequest): Promise<{ sessionId: SessionId; folder: DriveFolder }> {
    checkText(text)
    const base = this.findFolder(folderId_)
    const target = worktree === undefined ? base : this.deps.describeFolder(await this.deps.createWorktree(base.path, worktree), base.name)
    const { sessionId } = await this.deps.chat.startNew(target.path)
    // Watched before the first message goes, so a first turn that ends before the store knows the session is still heard.
    this.track(sessionId)
    this.deps.chat.send(sessionId, text)
    await this.untilKnown(sessionId)
    this.open(sessionId)
    log.info('driving', 'session started', { sessionId, worktree: worktree !== undefined })
    return { sessionId, folder: this.toDrive(target) }
  }

  interrupt(sessionId: SessionId): void {
    const w = this.watches.get(sessionId)
    if (w !== undefined) w.interrupting = true
    this.deps.chat.interrupt(sessionId)
  }

  answer(sessionId: SessionId, requestId: string, decision: ChatDecision): void {
    this.watches.get(sessionId)?.answered.add(requestId)
    this.deps.chat.respond(sessionId, requestId, decision)
  }

  watch(sessionId: SessionId): void {
    this.requireSession(sessionId)
    this.track(sessionId)
  }

  /** Starts watching without asking the store: a new session is unknown to it until its file is scanned. */
  private track(sessionId: SessionId): void {
    if (this.watches.has(sessionId)) return
    const state = this.deps.chat.state(sessionId)
    this.watches.set(sessionId, {
      busy: state?.status === 'busy', interrupting: false, since: state === null ? null : this.deps.now(),
      open: new Set(state?.permissions.map((p) => p.requestId) ?? []), answered: new Set(), stopped: state?.status === 'exited',
    })
  }

  unwatch(sessionId: SessionId): void { this.watches.delete(sessionId) }
  watched(): SessionId[] { return [...this.watches.keys()] }

  stateOf(sessionId: SessionId): { title: string; status: 'working' | 'waiting' | 'idle' | 'stopped' | 'unknown'; since: number | null } {
    const w = this.watches.get(sessionId)
    const title = this.titleOf(sessionId)
    if (w === undefined) return { title, status: 'unknown', since: null }
    if (w.stopped) return { title, status: 'stopped', since: w.since }
    if (w.open.size > 0) return { title, status: 'waiting', since: w.since }
    return { title, status: w.busy ? 'working' : 'idle', since: w.since }
  }

  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
    this.watches.clear()
  }

  private emit(event: SessionEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  private titleOf(id: SessionId): string { return this.deps.session(id)?.title ?? id.slice(0, 8) }

  private requireSession(id: SessionId): void {
    if (this.deps.session(id) === null) throw new Error(`Unknown session: ${id}`)
  }

  private findFolder(id: string): FolderSource {
    const found = this.deps.folders().find((f) => folderId(f.path) === id)
    if (found === undefined) throw new Error(`Unknown folder: ${id}`)
    return found
  }

  private toDrive(f: FolderSource): DriveFolder {
    return { id: folderId(f.path), name: f.name, branch: f.branch, isRepo: f.isRepo, worktreeOf: f.worktreeOf }
  }

  private open(id: SessionId): void {
    try { this.deps.openSession(id) } catch (e) { log.warn('driving', 'could not open the session tab', { sessionId: id, error: errorMessage(e) }) }
  }

  private async deliver(sessionId: SessionId, text: string): Promise<void> {
    await this.deps.chat.start(sessionId, { takeOver: true })
    this.deps.chat.send(sessionId, text)
    this.open(sessionId)
  }

  /** Checks the terminal every 5 s; once its turn has ended, takes it over and sends. */
  private waitForTerminal(sessionId: SessionId, text: string): void {
    const startedAt = this.deps.now()
    const stop = (reason: string): void => {
      if (!this.disposed) this.emit({ kind: 'stopped', sessionId, title: this.titleOf(sessionId), reason })
    }
    void (async () => {
      while (!this.disposed) {
        await this.deps.sleep(TERMINAL_CHECK_MS)
        if (this.disposed) return
        let busy: TerminalBusy
        try { busy = await this.deps.chat.terminalBusy(sessionId) } catch (e) { stop(errorMessage(e)); return }
        if (busy.busy) {
          if (this.deps.now() - startedAt >= TERMINAL_GIVE_UP_MS) { stop('Its terminal was still busy after 30 minutes.'); return }
          continue
        }
        try {
          await this.deliver(sessionId, text)
          if (!this.disposed) this.emit({ kind: 'delivered', sessionId, title: this.titleOf(sessionId) })
        } catch (e) { stop(errorMessage(e)) }
        return
      }
    })()
  }

  /** A new session is unknown to the store until its file is scanned: wait, asking for a scan now and then. */
  private async untilKnown(sessionId: SessionId): Promise<void> {
    const startedAt = this.deps.now()
    for (let i = 0; this.deps.now() - startedAt < KNOWN_WAIT_MS && !this.disposed; i++) {
      if (this.deps.session(sessionId) !== null) return
      if (i % 5 === 2) await this.deps.refresh().catch((e: unknown) => { log.warn('driving', 'refresh failed', { error: errorMessage(e) }) })
      await this.deps.sleep(1000)
    }
    if (this.deps.session(sessionId) === null) throw new Error(`The new session ${sessionId} was not found after 60 seconds.`)
  }

  private heard(state: ChatState): void {
    const from = state.previousSessionId
    if (from !== null && this.watches.has(from) && !this.watches.has(state.sessionId)) {
      const moved = this.watches.get(from)
      if (moved !== undefined) {
        this.watches.delete(from)
        this.watches.set(state.sessionId, moved)
        this.emit({ kind: 'moved', sessionId: state.sessionId, from })
      }
    }
    const w = this.watches.get(state.sessionId)
    if (w === undefined || w.stopped) return
    const title = this.titleOf(state.sessionId)
    const now = new Set(state.permissions.map((p) => p.requestId))
    for (const request of state.permissions) {
      if (!w.open.has(request.requestId)) { w.open.add(request.requestId); w.since = this.deps.now(); this.emit({ kind: 'permission', sessionId: state.sessionId, title, request }) }
    }
    for (const id of [...w.open]) {
      if (now.has(id)) continue
      w.open.delete(id)
      if (!w.answered.delete(id)) this.emit({ kind: 'permission-gone', sessionId: state.sessionId, requestId: id })
    }
    if (state.status === 'exited') {
      w.stopped = true
      this.emit({ kind: 'stopped', sessionId: state.sessionId, title, reason: state.error })
      return
    }
    const busy = state.status === 'busy'
    if (busy !== w.busy) w.since = this.deps.now()
    if (w.busy && state.status === 'idle') {
      const interrupted = w.interrupting
      w.interrupting = false
      this.emit({
        kind: 'turn-ended', sessionId: state.sessionId, title, text: cutEventText(finalText(state)),
        backgroundTasks: state.backgroundTasks?.length ?? 0, interrupted,
      })
    }
    w.busy = busy
  }
}

function checkText(text: string): void {
  if (text.length < 1 || text.length > MAX_DRIVEN_MESSAGE_CHARS) throw new Error(`A message is 1 to ${String(MAX_DRIVEN_MESSAGE_CHARS)} characters.`)
}
