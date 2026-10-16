/*
 * SessionActions: the per-session mutations - rename, note, remove, move. Owns no
 * state. Liveness is read from SessionCatalog (`isLive`, the last scan) plus the pty manager (this
 * process's own ptys); every id goes through
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
   * Saves the user's note for a session, and writes it to the index here rather than leaving it to
   * the next background pass, so it is searchable at once.
   */
  async setSessionNote(sessionId: string, note: string): Promise<void> {
    this.deps.resolver.requireSession(sessionId)
    const trimmed = note.trim()
    this.deps.store.setNote(sessionId, trimmed === '' ? null : trimmed)
    this.deps.search.putNoteIfEnabled(sessionId, trimmed === '' ? null : trimmed)
  }

  /**
   * The note for one session. `getSession` is an indexed lookup by primary key; `allSessions().find(...)`
   * would map and scan every row in the store.
   */
  sessionNote(sessionId: string): string {
    return this.deps.store.getSession(sessionId)?.note ?? ''
  }

  /**
   * Sets (or, given an empty/whitespace-only string, clears) a session's user-facing title.
   * The session must already be one this store knows about.
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
    // Both sources, because neither alone is current: the catalog's external process scan lags
    // behind a session resumed *here* a moment ago, while `pty.has()` knows at once. Moving the
    // JSONL out from under a running Claude Code makes it recreate the file at the old path,
    // splitting the history.
    if (this.deps.pty.has(sessionId) || this.deps.catalog.isLive(sessionId)) {
      throw new Error('This session is still running — stop it before moving it to another worktree.')
    }
    if (!existsSync(session.filePath)) {
      throw new Error(`This session's transcript file is no longer on disk: ${session.filePath}`)
    }
    // The renderer's path is checked against a row this store already holds before it touches the
    // filesystem (as `newSessionInProject` does).
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
