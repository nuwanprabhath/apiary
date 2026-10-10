import { existsSync } from 'node:fs'
import type { SessionStore, StoredSession } from '../store/sessionStore'
import type { PtyManager } from '../pty/ptyManager'
import type { TerminalRef } from '@shared/domain/ids'

export interface SessionResolverDeps {
  store: SessionStore
  pty: PtyManager
}

/**
 * The trust boundary shared by the git, shell, plugin and VS Code paths (MAIN-14 step 2): every
 * cwd-carrying IPC call resolves through `resolveShellCwd`, and every renderer-supplied session or
 * folder id is checked against a row this process already knows about before anything acts on it.
 * Moved out of `AppService` as a pure move — behaviour, ordering and error text are unchanged; see
 * `tests/unit/sessionResolver.test.ts`.
 *
 * Owns `listedWorktrees` (the worktree paths `listWorktrees` has reported), which used to be a
 * private `AppService` field written from one method and read from another. It moves here in its
 * entirety rather than being duplicated, so there is exactly one place that can go stale.
 */
export class SessionResolver {
  private readonly store: SessionStore
  private readonly pty: PtyManager
  /** Worktree paths `listWorktrees` has reported — see `rememberWorktree`/`isKnownWorktree`. */
  private readonly listedWorktrees = new Set<string>()

  constructor(deps: SessionResolverDeps) {
    this.store = deps.store
    this.pty = deps.pty
  }

  requireSession(sessionId: string): StoredSession {
    const session = this.findSession(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
  }

  findSession(sessionId: string): StoredSession | null {
    return this.store.getSession(sessionId)
  }

  /**
   * A sidebar folder named by the renderer, checked before anything acts on it: a stored project,
   * or the repository a stored worktree belongs to (the heading the tree draws above its
   * worktrees, which has no project row of its own until a session is started in it).
   */
  requireFolder(path: string): string {
    const project = this.store.getProject(path)
    if (project) return project.path
    if (this.store.isRepoRootOfWorktree(path)) return path
    throw new Error(`Unknown project: ${path}`)
  }

  /**
   * Resolves a session id or (for a `pty` ref) a still-pending session's pty id to its real,
   * existing cwd — the one trust boundary every cwd-carrying IPC call (shells, and now git
   * operations) goes through, so the renderer never gets to hand in a raw filesystem path.
   */
  resolveShellCwd(terminal: TerminalRef): string {
    const cwd = terminal.kind === 'pty' ? this.pty.getCwd(terminal.id) : this.requireSession(terminal.id).cwd
    if (!cwd) throw new Error(`Unknown session: ${terminal.id}`)
    if (!existsSync(cwd)) throw new Error(`The folder for this session no longer exists: ${cwd}`)
    return cwd
  }

  /** Records a worktree path found by `listWorktrees`, so a session can later be started in it
   *  (`newSessionInProject`) without re-deriving it from git or requiring a project row first. */
  rememberWorktree(path: string): void {
    this.listedWorktrees.add(path)
  }

  isKnownWorktree(path: string): boolean {
    return this.listedWorktrees.has(path)
  }
}
