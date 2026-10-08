/*
 * SessionActions (MAIN-14 step 6): the per-session mutations - rename, note, remove, move. Owns no
 * state. Liveness is read from SessionCatalog (`isLive`, the last scan) plus the pty manager (this
 * process's own ptys), exactly as `moveSession` did before the split; every id goes through
 * SessionResolver.requireSession first.
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { moveFile } from '../fs/moveFile'
import type { WorktreeResolver } from '../git/worktreeResolver'
import type { SessionStore } from '../store/sessionStore'
import type { SessionSource } from '../sources/claudeProjects'
import type { SessionResolver } from './sessionResolver'
import type { SessionCatalog } from './sessionCatalog'
import type { SearchService } from '../search/searchService'
import type { PtyManager } from '../pty/ptyManager'

export interface SessionActionsDeps {
  store: SessionStore
  source: SessionSource
  resolver: SessionResolver
  catalog: SessionCatalog
  search: SearchService
  pty: PtyManager
  worktrees: WorktreeResolver
}

export class SessionActions {
  constructor(private readonly deps: SessionActionsDeps) {}

  /**
   * Saves the user's note for a session, and keeps the index in step with it.
   *
   * The index write happens here rather than being left to the next background pass: a note is
   * written so it can be found again, and a note that is not searchable until some later rescan
   * is a note that appears not to work.
   */
  async setSessionNote(sessionId: string, note: string): Promise<void> {
    this.deps.resolver.requireSession(sessionId)
    const trimmed = note.trim()
    this.deps.store.setNote(sessionId, trimmed === '' ? null : trimmed)
    this.deps.search.putNoteIfEnabled(sessionId, trimmed === '' ? null : trimmed)
  }

  /**
   * The note for one session, for the editor to open with what is already there.
   *
   * `getSession` is an indexed lookup by primary key; `allSessions().find(...)` (MAIN-10) mapped
   * and scanned every row in the store to find one.
   */
  sessionNote(sessionId: string): string {
    return this.deps.store.getSession(sessionId)?.note ?? ''
  }

  /**
   * Sets (or, given an empty/whitespace-only string, clears) a session's user-facing title.
   * Validated the same way every other id-carrying call is: the session must already be one this
   * store knows about, never trusted purely because the renderer sent an id that looks right.
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    this.deps.resolver.requireSession(sessionId)
    const trimmed = title.trim()
    this.deps.store.setCustomTitle(sessionId, trimmed === '' ? null : trimmed)
  }

  /**
   * Removes a session from Apiary's own view without touching the JSONL file it was read from
   * (`~/.claude/projects` stays strictly read-only — see the comment on `SessionStore.setArchived`).
   * Refuses while a live process is still attached to it: silently hiding a session that is still
   * being written to would make it unreachable from the UI while the process outlives it.
   */
  async removeSession(sessionId: string): Promise<void> {
    this.deps.resolver.requireSession(sessionId)
    if (this.deps.catalog.isLive(sessionId)) {
      throw new Error('This session is still running — close it before removing it.')
    }
    this.deps.store.setArchived(sessionId, true)
  }

  /**
   * Moves a session's transcript into another worktree's Claude projects directory and points the
   * store at it from then on. Refused outright while the session is live: a running pty cannot be
   * asked to change the directory a whole process tree is rooted in.
   */
  async moveSession(sessionId: string, targetProjectPath: string): Promise<void> {
    const session = this.deps.resolver.requireSession(sessionId)
    // Both sources of liveness, because neither one alone is current. `this.live` is the external
    // process scan, refreshed only by `refresh()` — so a session the user resumed *here* a moment
    // ago is not in it until the next rescan. `this.deps.pty.has()` is this process's own ptys, which
    // is what `resume()` and `openShell()` already trust, and it knows immediately. With only the
    // stale half, clicking Resume and then dragging that session onto another worktree passed the
    // guard and renamed the JSONL out from under a running Claude Code, which simply recreated the
    // file at the old path — the history then split in two, with the store pointing at the copy
    // that stopped being written to.
    if (this.deps.pty.has(sessionId) || this.deps.catalog.isLive(sessionId)) {
      throw new Error('This session is still running — stop it before moving it to another worktree.')
    }
    if (!existsSync(session.filePath)) {
      throw new Error(`This session's transcript file is no longer on disk: ${session.filePath}`)
    }
    // The renderer only ever hands back a path it was shown in the tree (a project row's own
    // path), but it is still checked against a row this store already holds before it is used to
    // touch the filesystem — the same rule newSessionInProject follows for the same reason.
    const known = this.deps.store.getProject(targetProjectPath)
    if (!known) throw new Error(`Unknown project: ${targetProjectPath}`)
    const target = await this.deps.worktrees.resolveProject(known.path)

    const targetFile = this.deps.source.transcriptPathFor(target.path, sessionId)
    const targetDir = dirname(targetFile)
    if (existsSync(targetFile)) {
      throw new Error(`A session already exists there: ${targetFile}`)
    }

    await mkdir(targetDir, { recursive: true })
    await moveFile(session.filePath, targetFile)

    this.deps.store.syncProject(target)
    this.deps.store.recordSessionMove(sessionId, target.path, target.path, targetFile)
  }
}
