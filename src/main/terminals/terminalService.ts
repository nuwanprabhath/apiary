import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PtyManager } from '../pty/ptyManager'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { SessionStore } from '../store/sessionStore'
import { resolveProject } from '../git/worktreeResolver'
import { buildResumeCommand, buildNewSessionCommand } from '../pty/resumeCommand'
import { promptPathEnv, type PromptPathOptions } from '../pty/promptPath'
import { forkLabel } from '@shared/forkLabel'
import { stripPasteControls } from '@shared/pasteSafe'
import { newPendingPtyId, shellPtyId } from '@shared/domain/ptyId'
import { log } from '../log/logger'
import type { NewSessionInfo } from '@shared/types'

/**
 * Terminal bracketed-paste markers. Sending a multi-line prompt as a *paste* rather than as
 * keystrokes is what stops the receiving TUI treating the first newline as "submit" and firing off
 * a half-written message — the same mechanism a terminal uses when you paste into it by hand.
 */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export interface TerminalServiceDeps {
  pty: PtyManager
  resolver: SessionResolver
  store: SessionStore
  claudeBin?: string
  promptPath?: PromptPathOptions
  /** The zsh startup shim the minimal prompt needs (see pty/promptPath.ts), or none. */
  zshPromptShim?: string
}

/**
 * Resuming, forking, starting and attaching to Claude sessions and plain shells, plus delivering a
 * composed prompt (MAIN-14 step 4) — pure move out of `AppService`. Every attach-instead-of-spawn
 * guard, every comment explaining a past bug (CLAUDE.md's "never spawn over a live id", the
 * bracketed-paste and settle-timing rules in `sendPrompt`) is unchanged; see
 * `tests/integration/appService/composer.test.ts`, which still exercises all of this through `AppService`'s
 * unchanged delegating methods.
 *
 * Owns `claudeBin` and `promptPath` — both used only by the methods here (and by `AppService`'s
 * public `claudeBin` getter/`setClaudeBin`/`setPromptPath`, which now delegate to this class).
 */
export class TerminalService {
  private readonly pty: PtyManager
  private readonly resolver: SessionResolver
  private readonly store: SessionStore
  private claudeBin: string | undefined
  private promptPath: PromptPathOptions
  private readonly zshPromptShim: string | undefined

  constructor(deps: TerminalServiceDeps) {
    this.pty = deps.pty
    this.resolver = deps.resolver
    this.store = deps.store
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
    // The exact answer to "I turned the setting on and my prompt is still long": what the app
    // decided, and what it will actually put in the environment.
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

  /**
   * Spawns `claude --resume` in the session's recorded cwd. Terminal id is the session id.
   *
   * **An already-running pty is attached to, never replaced.** The same session can legitimately
   * be live in two windows at once (see `AppService.checkConflict`'s own comment), and each window
   * is a separate renderer that cannot see what another one has already started — this is exactly
   * what surfaced restoring after a relaunch: both windows recorded the session as `live` at quit,
   * both call `resume()` independently on mount, and without this check the second call would hit
   * `spawn()`'s unconditional `kill()` and restart the pty out from under the first window
   * mid-startup. `this.pty.has` is the same check `openShell` already makes for the equivalent
   * shell-tab collision.
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
    this.pty.spawn({
      id: sessionId,
      cwd,
      command: buildResumeCommand(sessionId, { claudeBin: this.claudeBin }),
      tui: true,
      // Claude takes the screen, so its own prompt is not bash's — but the shell is still there
      // underneath and is what you are left looking at the moment Claude exits, which is where a
      // 90-column worktree path greets you. This was missed when the setting was added: it reached
      // the shell tabs and not the session's own terminal, so the setting looked broken to anyone
      // who tried it on the terminal they actually use.
      env: this.env(),
    })
  }

  /**
   * Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>:<tabId>` — more
   * than one tab can exist per session; each is addressed by its own tabId.
   *
   * **An existing shell is attached to, never replaced.** Shell tab ids are minted per window and
   * the first one is always `1`, so opening the shell for a session that is already open in
   * another window asked for the id that window was using — and `spawn()` kills whatever is under
   * an id before taking it. A build, a `tail -f`, an editor, anything running in the first
   * window's shell died the moment the second window showed the same session, with nothing said.
   * Attaching is now a real answer rather than a blank pane, because a view that arrives late is
   * caught up from a rendered snapshot (see `PtyManager.snapshot`), not a raw byte replay.
   */
  async openShell(sessionId: string, tabId: string): Promise<void> {
    const id = shellPtyId(sessionId, tabId)
    if (this.pty.has(id)) {
      log.info('shell', 'attaching to a shell that is already running', { id })
      return
    }
    const cwd = this.resolver.resolveShellCwd(sessionId, false)
    this.pty.spawn({
      id,
      cwd,
      command: 'exec "$SHELL" -l',
      env: this.env(),
    })
  }

  /**
   * Same as `openShell`, but for a new session's pty before it has a real session id yet, keyed
   * `shell:<ptyId>:<tabId>`.
   */
  async openShellForPty(ptyId: string, tabId: string): Promise<void> {
    const id = shellPtyId(ptyId, tabId)
    if (this.pty.has(id)) return
    const cwd = this.resolver.resolveShellCwd(ptyId, true)
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
    // Neither a worktree `listWorktrees` found in git nor a repository heading has a project row
    // yet. One is made first, so the auto-import flag `startNewSession` sets has a row to go on.
    if (!this.resolver.isKnownWorktree(path)) this.resolver.requireFolder(path)
    const info = await resolveProject(path)
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
    const info = await resolveProject(path)
    this.store.syncProject(info)
    return this.startNewSession(info.path)
  }

  /**
   * Forks a session: starts `claude --resume <id> --fork-session`, which replays the conversation
   * so far into a *new* session rather than continuing the old one.
   *
   * Deliberately routed through the same `new:<uuid>` pty bookkeeping as starting a session from
   * scratch, not through `resume()`. A fork's session id does not exist yet — Claude mints it and
   * writes the JSONL itself — so there is nothing to key the terminal by until the watcher finds
   * it, which is exactly the problem the pending-session machinery already solves. The one thing
   * that differs is the label, and the renderer carries that across as a rename once the real id
   * appears.
   *
   * The original is untouched, which is the point of forking rather than branching in place: the
   * conversation you forked from is still there to go back to.
   */
  forkSession(sessionId: string): NewSessionInfo {
    const session = this.resolver.requireSession(sessionId)
    const cwd = session.cwd
    if (!cwd || !existsSync(cwd)) {
      throw new Error(`The folder for this session no longer exists: ${cwd ?? 'unknown'}`)
    }
    this.store.setAutoImport(cwd, true)
    const ptyId = newPendingPtyId(randomUUID())
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildResumeCommand(sessionId, { fork: true, claudeBin: this.claudeBin }),
      tui: true,
      env: this.env(),
    })
    return { ptyId, cwd, label: forkLabel(session.title ?? (basename(cwd) || cwd)) }
  }

  /**
   * Spawns `claude` (no `--resume`) in `cwd`, keyed under a fresh `new:<uuid>` pty id — there is
   * no session id yet, so it cannot be keyed like `resume()`/`openShell()` are. Also flips the
   * project's `auto_import` flag so the session the watcher discovers once Claude writes its
   * JSONL (and any future session started in this folder) shows up in the sidebar on its own,
   * the same mechanism ticking a folder header in the import dialog already uses.
   */
  private startNewSession(cwd: string): NewSessionInfo {
    if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`)
    this.store.setAutoImport(cwd, true)
    const ptyId = newPendingPtyId(randomUUID())
    this.pty.spawn({
      id: ptyId,
      cwd,
      command: buildNewSessionCommand({ claudeBin: this.claudeBin }),
      tui: true,
      env: this.env(),
    })
    return { ptyId, cwd, label: basename(cwd) || cwd }
  }

  /**
   * Delivers a composed prompt to a session's running `claude` process.
   *
   * Wrapped in bracketed-paste markers so the whole thing arrives as one paste: without them a
   * multi-line message submits at its first newline, sending a fragment and leaving the rest to be
   * interpreted as new prompts. The trailing carriage return is the actual "send".
   *
   * Both waits are load-bearing, and both were found by measuring a real `claude` rather than
   * reasoning about it:
   *
   * - Before the paste, because sending a message resumes a stopped session first, and the pty
   *   exists a good second before `claude` is listening. Written into that gap, the message is
   *   swallowed by the terminal's line discipline instead (see `whenQuiet`) — it appears in the
   *   input box, unsent, with its return turned into a newline, and needs an Enter by hand.
   * - Before the return, because it only counts as "submit" once the TUI has taken the paste in.
   *   Measured at ~20ms on an idle session but ~90ms on a busy one, so a fixed delay is a guess;
   *   waiting for the TUI to stop drawing is the thing that was actually being guessed at.
   */
  async sendPrompt(ptyId: string, text: string): Promise<void> {
    if (!this.pty.has(ptyId)) throw new Error('This session is not running.')
    // Stripped before wrapping: an ESC[201~ in the text would close the bracketed paste early,
    // and everything after it would run as keystrokes instead of arriving as literal text
    // (SEC-6) — the classic pastejacking bypass, since bracketed paste only protects a payload
    // that cannot spell its own end marker.
    const normalised = stripPasteControls(text.replace(/\r\n/g, '\n').replace(/\s+$/, ''))
    if (normalised === '') return
    await this.pty.whenQuiet(ptyId, { quietMs: 250, capMs: 20_000 })
    const before = this.pty.outputCount(ptyId)
    this.pty.write(ptyId, PASTE_START + normalised + PASTE_END)
    await this.pty.whenQuiet(ptyId, { quietMs: 150, capMs: 1500, after: before })
    this.pty.write(ptyId, '\r')
  }
}
