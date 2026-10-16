import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PtyManager } from '../pty/ptyManager'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { SessionStore } from '../store/sessionStore'
import type { WorktreeResolver } from '../git/worktreeResolver'
import { buildResumeCommand, buildNewSessionCommand } from '../pty/resumeCommand'
import { promptPathEnv, type PromptPathOptions } from '../pty/promptPath'
import { forkLabel } from '@shared/forkLabel'
import { stripPasteControls } from '@shared/pasteSafe'
import { newPendingPtyId, shellPtyId } from '@shared/domain/ptyId'
import { asSessionId, type AccountId, type PtyId, type SessionId } from '@shared/domain/ids'
import type { LaunchAccounts } from '../accounts/accountService'
import { log } from '../log/logger'
import type { NewSessionInfo } from '@shared/types'

/** Bracketed-paste markers: a multi-line prompt sent as a paste is not submitted at its first newline. */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export interface TerminalServiceDeps {
  pty: PtyManager
  resolver: SessionResolver
  store: SessionStore
  worktrees: WorktreeResolver
  claudeBin?: string
  promptPath?: PromptPathOptions
  /** The zsh startup shim the minimal prompt needs (see pty/promptPath.ts), or none. */
  zshPromptShim?: string
  /** Every `claude` it starts runs under an account's environment. */
  accounts: LaunchAccounts
  /** Where a login session runs. */
  homeDir: string
}

/**
 * Resuming, forking, starting and attaching to Claude sessions and plain shells, plus delivering a
 * composed prompt. Every attach-instead-of-spawn guard (CLAUDE.md's "never spawn over a live id")
 * and the bracketed-paste and settle-timing rules in `sendPrompt` live here; see
 * `tests/integration/appService/composer.test.ts`.
 */
export class TerminalService {
  private readonly pty: PtyManager
  private readonly resolver: SessionResolver
  private readonly store: SessionStore
  private readonly worktrees: WorktreeResolver
  private claudeBin: string | undefined
  private promptPath: PromptPathOptions
  private readonly zshPromptShim: string | undefined
  private readonly accounts: LaunchAccounts
  private readonly homeDir: string

  constructor(deps: TerminalServiceDeps) {
    this.accounts = deps.accounts
    this.homeDir = deps.homeDir
    this.pty = deps.pty
    this.resolver = deps.resolver
    this.store = deps.store
    this.worktrees = deps.worktrees
    this.claudeBin = deps.claudeBin
    this.promptPath = deps.promptPath ?? { enabled: false, segments: 2 }
    this.zshPromptShim = deps.zshPromptShim
  }

  /** The configured `claude`, or null for "find it on PATH" — the theme generator runs the same one. */
  getClaudeBin(): string | null {
    return this.claudeBin ?? null
  }

  setClaudeBin(path: string | null): void {
    this.claudeBin = path ?? undefined
  }

  /**
   * Changes how shells started from now on show their path. Shells already running keep the
   * environment they were spawned with — a variable cannot be pushed into a live process — so the
   * setting's help text says the change applies to new terminals.
   */
  setPromptPath(options: PromptPathOptions): void {
    log.info('prompt', 'prompt trim configured', {
      enabled: options.enabled,
      segments: options.segments,
      minimal: options.minimal ?? false,
      env: promptPathEnv(options, this.zshPromptShim ?? null),
    })
    this.promptPath = options
  }

  private env(): Record<string, string> {
    return promptPathEnv(this.promptPath, this.zshPromptShim ?? null)
  }

  /** What a `claude` under `account` runs with: the prompt settings, then the account's own folder. */
  private claudeEnv(account: AccountId): Record<string, string> {
    return { ...this.env(), ...this.accounts.launchEnv(account) }
  }

  /**
   * Switching a running session's account: the `claude` is killed and the resume command spawned on
   * the same pty id, at the size it had. The id keeps its views — `kill()` drops the old child's
   * callbacks (they check they are still the occupant), so no window is told the pty died.
   */
  async respawn(sessionId: SessionId): Promise<void> {
    const session = this.resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    const account = this.accounts.accountOf(sessionId)
    await this.pty.killAndWait(sessionId)
    this.pty.spawn({
      id: sessionId, cwd, tui: true, account, ...this.pty.sizeOf(sessionId),
      command: buildResumeCommand(sessionId, { claudeBin: this.claudeBin }),
      env: this.claudeEnv(account),
    })
  }

  /**
   * Starts a new session under `accountId` for the user to log in: `claude` asks for a login on its
   * own when the account has none. It runs in the home folder, and that folder is not made an
   * auto-import project, since nothing is meant to be written there.
   */
  login(accountId: AccountId): NewSessionInfo {
    const ptyId = newPendingPtyId(randomUUID())
    this.pty.spawn({
      id: ptyId, cwd: this.homeDir, tui: true, account: accountId,
      command: buildNewSessionCommand({ claudeBin: this.claudeBin }),
      env: this.claudeEnv(accountId),
    })
    return { ptyId, cwd: this.homeDir, label: 'Log in' }
  }

  /**
   * Spawns `claude --resume` in the session's recorded cwd. Terminal id is the session id.
   *
   * **An already-running pty is attached to, never replaced.** The same session can be live in two
   * windows, and each renderer calls `resume()` on its own (after a relaunch both do), so without
   * this check the second call would hit `spawn()`'s unconditional `kill()` and restart the pty
   * under the first window.
   */
  async resume(sessionId: string): Promise<void> {
    if (this.pty.has(sessionId)) {
      log.info('resume', 'attaching to a session that is already running', { sessionId })
      return
    }
    const session = this.resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    const account = this.accounts.accountOf(asSessionId(sessionId))
    this.pty.spawn({
      id: sessionId,
      cwd,
      command: buildResumeCommand(sessionId, { claudeBin: this.claudeBin }),
      tui: true,
      account,
      // The shell under Claude is what is left on screen when Claude exits, so it needs the prompt settings too.
      env: this.claudeEnv(account),
    })
  }

  /**
   * Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>:<tabId>` — more
   * than one tab can exist per session; each is addressed by its own tabId.
   *
   * **An existing shell is attached to, never replaced.** Shell tab ids are minted per window and
   * the first is always `1`, so a second window showing the session asks for the id the first
   * is using, and `spawn()` kills whatever is under an id. A late view is caught up from a rendered
   * snapshot (see `PtyManager.snapshot`).
   */
  async openShell(sessionId: SessionId, tabId: string): Promise<void> {
    const id = shellPtyId(sessionId, tabId)
    if (this.pty.has(id)) {
      log.info('shell', 'attaching to a shell that is already running', { id })
      return
    }
    const cwd = this.resolver.resolveShellCwd({ kind: 'session', id: sessionId })
    this.pty.spawn({
      id,
      cwd,
      command: 'exec "$SHELL" -l',
      env: this.env(),
    })
  }

  /** `openShell` for a new session's pty, which has no session id yet: keyed `shell:<ptyId>:<tabId>`. */
  async openShellForPty(ptyId: PtyId, tabId: string): Promise<void> {
    const id = shellPtyId(ptyId, tabId)
    if (this.pty.has(id)) return
    const cwd = this.resolver.resolveShellCwd({ kind: 'pty', id: ptyId })
    this.pty.spawn({
      id,
      cwd,
      command: 'exec "$SHELL" -l',
      env: this.env(),
    })
  }

  /**
   * Starts a brand-new (non-`--resume`) session in a project the store already knows about.
   * `path` comes from the renderer, so it is validated against a stored project row rather than
   * trusted directly — an unknown path is rejected before it ever reaches `PtyManager`, the same
   * invariant every other path-carrying IPC call preserves.
   */
  async newSessionInProject(path: string): Promise<NewSessionInfo> {
    const project = this.store.getProject(path)
    if (project) return this.startNewSession(project.path)
    // A worktree found in git or a repository heading may have no project row yet; `startNewSession` sets a flag on one.
    if (!this.resolver.isKnownWorktree(path)) this.resolver.requireFolder(path)
    const info = await this.worktrees.resolveProject(path)
    this.store.syncProject(info)
    return this.startNewSession(info.path)
  }

  /**
   * Starts a brand-new session in an arbitrary folder. Only safe to call with a path the main
   * process obtained itself (the native folder-picker dialog) — never with a string handed in
   * by the renderer. The folder may be entirely new to Apiary, so its project row is created
   * (or refreshed) first.
   */
  async newSessionInFolder(path: string): Promise<NewSessionInfo> {
    if (!existsSync(path)) throw new Error(`Folder does not exist: ${path}`)
    const info = await this.worktrees.resolveProject(path)
    this.store.syncProject(info)
    return this.startNewSession(info.path)
  }

  /**
   * Forks a session: starts `claude --resume <id> --fork-session`, which replays the conversation
   * so far into a *new* session and leaves the original untouched.
   *
   * Routed through the `new:<uuid>` pending pty bookkeeping, not `resume()`: Claude mints the
   * fork's session id and writes the JSONL itself, so nothing can key the terminal until the
   * watcher finds it. The renderer carries the label across as a rename once the real id appears.
   */
  forkSession(sessionId: string): NewSessionInfo {
    const session = this.resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.store.setAutoImport(cwd, true)
    const ptyId = newPendingPtyId(randomUUID())
    // A fork runs under its parent's account.
    const account = this.accounts.accountOf(asSessionId(sessionId))
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildResumeCommand(sessionId, { fork: true, claudeBin: this.claudeBin }),
      tui: true,
      account,
      env: this.claudeEnv(account),
    })
    return { ptyId, cwd, label: forkLabel(session.title ?? (basename(cwd) || cwd)) }
  }

  /**
   * Spawns `claude` (no `--resume`) in `cwd`, keyed under a fresh `new:<uuid>` pty id (no session
   * id yet). Also sets the project's `auto_import` flag so the session the watcher discovers, and
   * later ones in this folder, show up in the sidebar.
   */
  private startNewSession(cwd: string): NewSessionInfo {
    if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`)
    this.store.setAutoImport(cwd, true)
    const ptyId = newPendingPtyId(randomUUID())
    const account = this.accounts.defaultId()
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildNewSessionCommand({ claudeBin: this.claudeBin }),
      tui: true,
      account,
      env: this.claudeEnv(account),
    })
    return { ptyId, cwd, label: basename(cwd) || cwd }
  }

  /**
   * Delivers a composed prompt to a session's running `claude` process.
   *
   * Wrapped in bracketed-paste markers so a multi-line message arrives as one paste; the trailing
   * carriage return is the actual "send".
   *
   * Both waits are load-bearing (measured on a real `claude`):
   *
   * - Before the paste: resuming a stopped session leaves the pty up a good second before `claude`
   *   listens, and a message written into that gap is swallowed by the line discipline (see
   *   `whenQuiet`): it sits unsent in the input box.
   * - Before the return: it only submits once the TUI has taken the paste in, which took ~20ms on
   *   an idle session and ~90ms on a busy one.
   */
  async sendPrompt(ptyId: string, text: string): Promise<void> {
    if (!this.pty.has(ptyId)) throw new Error('This session is not running.')
    // Stripped before wrapping: an ESC[201~ in the text would end the paste early and run the rest
    // as keystrokes (pastejacking).
    const normalised = stripPasteControls(text.replace(/\r\n/g, '\n').replace(/\s+$/, ''))
    if (normalised === '') return
    await this.pty.whenQuiet(ptyId, { quietMs: 250, capMs: 20_000 })
    const before = this.pty.outputCount(ptyId)
    this.pty.write(ptyId, PASTE_START + normalised + PASTE_END)
    await this.pty.whenQuiet(ptyId, { quietMs: 150, capMs: 1500, after: before })
    this.pty.write(ptyId, '\r')
  }
}
