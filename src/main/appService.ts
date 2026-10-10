import type { PtyManager } from './pty/ptyManager'
import type { SessionStore, StoredSession } from './store/sessionStore'
import type { SessionCatalog } from './sessions/sessionCatalog'
import type { SessionActions } from './sessions/sessionActions'
import type { TranscriptService } from './sessions/transcriptService'
import type { GitService } from './git/gitService'
import type { SearchService } from './search/searchService'
import type { TerminalService } from './terminals/terminalService'
import type { VsCodeService } from './vscode/vscodeService'
import type { ImageStore } from './media/imageStore'
import type { ChatService } from './chat/chatService'
import type { PluginService } from './plugins/pluginService'
import type { PromptPathOptions } from './pty/promptPath'
import type { MrState } from './git/mrStatusCache'
import type { PtyId, SessionId, TerminalRef } from '@shared/domain/ids'
import type {
  ProjectNode, ResumeConflict, TranscriptPage, NewSessionInfo, CheckoutOutcome, GitStatus, GitRefs, FolderWorktree,
} from '@shared/types'
import type { GitTarget, WorktreeCreateOptions, WorktreeCreateRequest } from '@shared/domain/git'

/** Whether shutdown has begun. Read by the refresh loop and the search index, which stop scheduling
 *  and writing once it is set; set by `AppService.dispose()`. One flag, built in the container. */
export class DisposedFlag {
  private value = false
  get disposed(): boolean { return this.value }
  set(): void { this.value = true }
}

/** Everything `AppService` fronts. Built — and wired to one another — in `app/container.ts`. */
export interface AppServiceParts {
  pty: PtyManager
  store: SessionStore
  git: GitService
  vscode: VsCodeService
  images: ImageStore
  search: SearchService
  terminals: TerminalService
  catalog: SessionCatalog
  actions: SessionActions
  transcripts: TranscriptService
  chat: ChatService
  plugins: PluginService
  disposed: DisposedFlag
}

/**
 * The facade the IPC handlers (and most integration tests) call: every method forwards to the
 * service that owns the behaviour, in one statement — `tests/unit/architecture/appServiceDelegates.test.ts`
 * enforces that, with a short allowlist of what may not. It owns no state and builds nothing; the
 * container constructs the parts (`createServices`).
 *
 * Chat (`chat`) and plugins (`plugins`) are not fronted here: their handlers take the services
 * directly. `pty` is public for the same reason.
 */
export class AppService {
  readonly pty: PtyManager
  readonly chat: ChatService
  readonly plugins: PluginService
  private readonly store: SessionStore
  private readonly git: GitService
  private readonly vscode: VsCodeService
  private readonly images: ImageStore
  private readonly search: SearchService
  private readonly terminals: TerminalService
  private readonly catalog: SessionCatalog
  private readonly actions: SessionActions
  private readonly transcripts: TranscriptService
  private readonly state: DisposedFlag

  constructor(parts: AppServiceParts) {
    this.pty = parts.pty
    this.chat = parts.chat
    this.plugins = parts.plugins
    this.store = parts.store
    this.git = parts.git
    this.vscode = parts.vscode
    this.images = parts.images
    this.search = parts.search
    this.terminals = parts.terminals
    this.catalog = parts.catalog
    this.actions = parts.actions
    this.transcripts = parts.transcripts
    this.state = parts.disposed
  }

  /** Rescans and refreshes live-session state; see `sessions/sessionCatalog.ts` for the state machine. */
  async refresh(opts?: { full?: boolean; paths?: string[] }): Promise<void> {
    return this.catalog.refresh(opts)
  }

  /** One folder's project row re-resolved through git (MAIN-4); see SessionCatalog. */
  async refreshProject(cwd: string): Promise<void> {
    return this.catalog.refreshProject(cwd)
  }

  /** Same as `refreshProject`, but for one of the cwd-carrying git IPC calls. */
  async refreshProjectByKey(target: GitTarget): Promise<void> {
    return this.git.refreshProjectOf(target)
  }

  async tree(): Promise<ProjectNode[]> {
    return this.catalog.tree()
  }

  async discovered(): Promise<StoredSession[]> {
    return this.catalog.discovered()
  }

  async importAllDiscovered(): Promise<number> {
    return this.catalog.importAllDiscovered()
  }

  async importSessions(sessionIds: string[], autoImportProjects: string[]): Promise<void> {
    return this.catalog.importSessions(sessionIds, autoImportProjects)
  }

  sessionIsResumable(sessionId: string): boolean {
    return this.catalog.sessionIsResumable(sessionId)
  }

  setAutoImportAll(enabled: boolean): void {
    this.catalog.setAutoImportAll(enabled)
  }

  async checkConflict(sessionId: SessionId): Promise<ResumeConflict | null> {
    return this.chat.checkConflict(sessionId)
  }

  async transcript(sessionId: string, beforeIndex?: number): Promise<TranscriptPage> {
    return this.transcripts.page(sessionId, beforeIndex)
  }

  /** What each of these sessions is doing, for the pets; see `TranscriptService.latestActions`. */
  async latestActions(keys: string[]): Promise<{ key: string; action: string }[]> {
    return this.transcripts.latestActions(keys)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    return this.actions.renameSession(sessionId, title)
  }

  async removeSession(sessionId: string): Promise<void> {
    return this.actions.removeSession(sessionId)
  }

  async moveSession(sessionId: string, targetProjectPath: string): Promise<void> {
    return this.actions.moveSession(sessionId, targetProjectPath)
  }

  async setSessionNote(sessionId: string, note: string): Promise<void> {
    return this.actions.setSessionNote(sessionId, note)
  }

  sessionNote(sessionId: string): string {
    return this.actions.sessionNote(sessionId)
  }

  // Search: every method is a one-line delegate to SearchService (MAIN-14 step 4).

  /**
   * Session ids matched by anything other than their title: the conversation, the user's note, or
   * both, according to which of the two are switched on. They are independent — a note is a line
   * the user wrote and costs nothing to keep indexed, so it stays searchable even for someone who
   * has turned transcript indexing off.
   */
  async searchSessions(query: string): Promise<string[]> {
    return this.search.search(query)
  }

  setSearchChatContent(enabled: boolean): void {
    this.search.setChatContentEnabled(enabled)
  }

  setSearchSessionNotes(enabled: boolean): void {
    this.search.setSessionNotesEnabled(enabled)
  }

  async rebuildSearchIndex(): Promise<void> {
    return this.search.rebuild()
  }

  searchIndexCount(): number {
    return this.search.indexCount()
  }

  searchNoteCount(): number {
    return this.search.noteCount()
  }

  async updateSearchIndex(): Promise<void> {
    return this.search.update()
  }

  // Terminals: resume, openShell*, newSessionIn*, forkSession and sendPrompt are one-line delegates
  // to TerminalService (MAIN-14 step 4); `resume` goes through the chat first, which stops a chat
  // running on the session (one process per session).

  async resume(sessionId: SessionId): Promise<void> {
    return this.chat.resumeInTerminal(sessionId)
  }

  async openShell(sessionId: SessionId, tabId: string): Promise<void> {
    return this.terminals.openShell(sessionId, tabId)
  }

  async openShellForPty(ptyId: PtyId, tabId: string): Promise<void> {
    return this.terminals.openShellForPty(ptyId, tabId)
  }

  async newSessionInProject(path: string): Promise<NewSessionInfo> {
    return this.terminals.newSessionInProject(path)
  }

  /**
   * Starts a brand-new session in an arbitrary folder. Only safe to call with a path the main
   * process obtained itself (the native folder-picker dialog) — never with a string handed in
   * by the renderer.
   */
  async newSessionInFolder(path: string): Promise<NewSessionInfo> {
    return this.terminals.newSessionInFolder(path)
  }

  forkSession(sessionId: string): NewSessionInfo {
    return this.terminals.forkSession(sessionId)
  }

  /** Delivers a composed prompt to a session's running `claude` process. See
   *  `terminals/terminalService.ts` for the bracketed-paste and settle-timing rationale. */
  async sendPrompt(ptyId: string, text: string): Promise<void> {
    return this.terminals.sendPrompt(ptyId, text)
  }

  /**
   * Changes how shells started from now on show their path. Shells already running keep the
   * environment they were spawned with — a variable cannot be pushed into a live process — so the
   * setting's help text says the change applies to new terminals.
   */
  setPromptPath(options: PromptPathOptions): void {
    this.terminals.setPromptPath(options)
  }

  /** The configured `claude`, or null for "find it on PATH" — the theme generator runs the same one. */
  get claudeBin(): string | null {
    return this.terminals.getClaudeBin()
  }

  setClaudeBin(path: string | null): void {
    this.terminals.setClaudeBin(path)
  }

  // VS Code and pasted images.

  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  vsCodeAvailable(): boolean {
    return this.vscode.available()
  }

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async openInVsCode(terminal: TerminalRef): Promise<void> {
    return this.vscode.open(terminal)
  }

  /** Opens a file a transcript names, if it is inside the session's folder. Rejects otherwise. */
  async openMentionedFile(terminal: TerminalRef, mention: string): Promise<void> {
    return this.vscode.openMentionedFile(terminal, mention)
  }

  /**
   * Writes an image pasted into the composer to disk and returns its absolute path. See
   * `media/imageStore.ts` for why it lives on disk, in Apiary's own data directory.
   */
  async saveImage(base64: string, mediaType: string): Promise<string> {
    return this.images.save(base64, mediaType)
  }

  /**
   * Reads one previously-saved image back as a data URL, for the thumbnails and the lightbox. See
   * `media/imageStore.ts` for the confinement check.
   */
  async readImage(path: string): Promise<{ dataUrl: string } | null> {
    return this.images.read(path)
  }

  // Git: every method is a one-line delegate to GitService (MAIN-14 step 3).

  async gitStatus(terminal: TerminalRef): Promise<GitStatus | null> {
    return this.git.status(terminal)
  }

  async gitListRefs(target: GitTarget): Promise<GitRefs> {
    return this.git.listRefs(target)
  }

  async gitlabMrRefStatus(
    terminal: TerminalRef, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    return this.git.mrRefStatus(terminal, iids)
  }

  /** Forgets every cached merge-request state: what the Refresh button does. */
  invalidateMrStatuses(): void {
    this.git.invalidateMrStatuses()
  }

  async gitCheckoutBranch(target: GitTarget, name: string): Promise<CheckoutOutcome> {
    return this.git.checkoutBranch(target, name)
  }

  /** `branch` here, after the worktree that has it moves to `otherTo`; both rows re-resolved. */
  async gitCheckoutBranchMovingOther(target: GitTarget, branch: string, otherTo: string): Promise<void> {
    return this.git.checkoutBranchMovingOther(target, branch, otherTo)
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async gitPullWorktree(
    target: GitTarget, branch: string,
  ): Promise<{ path: string; commits: number }> {
    return this.git.pullWorktree(target, branch)
  }

  /** Starts a new Claude session in the worktree that has `branch`. */
  async newSessionInWorktree(
    target: GitTarget, branch: string,
  ): Promise<NewSessionInfo> {
    return this.git.newSessionInWorktree(target, branch)
  }

  async gitCheckoutRemote(target: GitTarget, remoteRef: string, localName: string): Promise<void> {
    return this.git.checkoutRemote(target, remoteRef, localName)
  }

  async gitCheckoutDetached(target: GitTarget, ref: string): Promise<void> {
    return this.git.checkoutDetached(target, ref)
  }

  async gitCreateBranch(target: GitTarget, name: string, from?: string): Promise<void> {
    return this.git.createBranch(target, name, from)
  }

  async gitPull(terminal: TerminalRef): Promise<{ commits: number }> {
    return this.git.pull(terminal)
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async gitUpdateBranch(target: GitTarget, branch: string): Promise<{ commits: number }> {
    return this.git.updateBranch(target, branch)
  }

  async gitPullFolder(path: string): Promise<{ commits: number }> {
    return this.git.pullFolder(path)
  }

  async worktreeCreateOptions(path: string): Promise<WorktreeCreateOptions> {
    return this.git.worktreeCreateOptions(path)
  }

  /** New worktree, then a Claude session in it — Apiary's "open" for a fresh worktree. */
  async createWorktree(path: string, request: WorktreeCreateRequest): Promise<NewSessionInfo> {
    return this.git.createWorktreeSession(path, request)
  }

  async listWorktrees(path: string): Promise<FolderWorktree[]> {
    return this.git.listWorktrees(path)
  }

  async gitPush(terminal: TerminalRef): Promise<{ commits: number; published: boolean }> {
    return this.git.push(terminal)
  }

  async gitMerge(target: GitTarget, ref: string): Promise<void> {
    return this.git.merge(target, ref)
  }

  async gitFetch(terminal: TerminalRef): Promise<void> {
    return this.git.fetch(terminal)
  }

  async dispose(): Promise<void> {
    // Set synchronously, before any await: any refresh loop currently checking
    // `this.pendingRefresh && !isDisposed()` in the same tick will see this and stop
    // scheduling further passes, so no fire-and-forget rerun can start after this point.
    this.state.set()
    this.plugins.stopStatusBar()
    await this.chat.stopAll()
    await this.pty.killAll()
    // Let any refresh already in flight (or its already-chained rerun) finish before closing
    // the database — otherwise it could try to write through a closed better-sqlite3 handle.
    await this.catalog.whenIdle()
    this.store.close()
    // Closes the index and the content-search worker thread's own SQLite handle (MAIN-20) — see
    // `SearchService.close`.
    await this.search.close()
    // Releases any plugin holding something of its own (MAIN-17/MAIN-20).
    this.plugins.dispose()
  }
}
