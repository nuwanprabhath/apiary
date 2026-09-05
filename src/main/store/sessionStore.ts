import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProjectInfo, SessionMeta } from '@shared/types'
import { SCHEMA } from './schema'

export interface StoredProject extends ProjectInfo {
  autoImport: boolean
}

export interface StoredSession extends SessionMeta {
  projectPath: string
  imported: boolean
  archived: boolean
}

interface ProjectRow {
  path: string; repo_root: string | null; is_worktree: number
  branch: string | null; exists_flag: number; auto_import: number
}

interface SessionRow {
  session_id: string; project_path: string; title: string | null
  custom_title: string | null
  first_prompt: string | null; cwd: string | null; git_branch: string | null
  started_at_ms: number | null; last_active_ms: number | null
  message_count: number | null; file_path: string; file_mtime_ms: number
  file_size: number; imported: number; archived: number
}

const toProject = (r: ProjectRow): StoredProject => ({
  path: r.path,
  repoRoot: r.repo_root,
  isWorktree: r.is_worktree === 1,
  branch: r.branch,
  exists: r.exists_flag === 1,
  autoImport: r.auto_import === 1,
})

const toSession = (r: SessionRow): StoredSession => ({
  sessionId: r.session_id,
  projectPath: r.project_path,
  // A user-set title always wins over whatever the scanner most recently read from the JSONL
  // (its own `ai-title`, or none at all) — otherwise the very next rescan would silently revert
  // a rename the moment Claude's own title-generation caught up or the file was re-read.
  title: r.custom_title ?? r.title,
  firstPrompt: r.first_prompt,
  cwd: r.cwd,
  gitBranch: r.git_branch,
  startedAtMs: r.started_at_ms,
  lastActiveAtMs: r.last_active_ms,
  messageCount: r.message_count,
  filePath: r.file_path,
  fileMtimeMs: r.file_mtime_ms,
  fileSize: r.file_size,
  imported: r.imported === 1,
  archived: r.archived === 1,
})

export class SessionStore {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /**
   * `CREATE TABLE IF NOT EXISTS` in schema.ts only shapes a brand-new database — an existing
   * `session` table from before a column was added keeps whatever shape it already had, so a
   * column introduced later needs an explicit, idempotent `ALTER TABLE` here instead. Checked via
   * `PRAGMA table_info` rather than a version counter to keep this self-contained and safe to run
   * on every startup regardless of what schema version (if any) the file was created with.
   */
  private migrate(): void {
    const columns = this.db.prepare<[], { name: string }>('PRAGMA table_info(session)').all()
    if (!columns.some((c) => c.name === 'custom_title')) {
      this.db.exec('ALTER TABLE session ADD COLUMN custom_title TEXT')
    }
  }

  syncProject(info: ProjectInfo): void {
    this.db.prepare(`
      INSERT INTO project (path, repo_root, is_worktree, branch, exists_flag)
      VALUES (@path, @repoRoot, @isWorktree, @branch, @exists)
      ON CONFLICT(path) DO UPDATE SET
        repo_root = excluded.repo_root,
        is_worktree = excluded.is_worktree,
        branch = excluded.branch,
        exists_flag = excluded.exists_flag
    `).run({
      path: info.path,
      repoRoot: info.repoRoot,
      isWorktree: info.isWorktree ? 1 : 0,
      branch: info.branch,
      exists: info.exists ? 1 : 0,
    })
  }

  /** Upserts metadata. Never clobbers `imported`; honours the project's auto-import flag for new rows. */
  syncSessions(projectPath: string, metas: SessionMeta[]): void {
    const auto = this.db
      .prepare<[string], { auto_import: number }>('SELECT auto_import FROM project WHERE path = ?')
      .get(projectPath)?.auto_import ?? 0

    const stmt = this.db.prepare(`
      INSERT INTO session (
        session_id, project_path, title, first_prompt, cwd, git_branch,
        started_at_ms, last_active_ms, message_count,
        file_path, file_mtime_ms, file_size, imported
      ) VALUES (
        @sessionId, @projectPath, @title, @firstPrompt, @cwd, @gitBranch,
        @startedAtMs, @lastActiveAtMs, @messageCount,
        @filePath, @fileMtimeMs, @fileSize, @imported
      )
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        first_prompt = excluded.first_prompt,
        cwd = excluded.cwd,
        git_branch = excluded.git_branch,
        started_at_ms = excluded.started_at_ms,
        last_active_ms = excluded.last_active_ms,
        file_path = excluded.file_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size
    `)

    const run = this.db.transaction((rows: SessionMeta[]) => {
      for (const m of rows) {
        stmt.run({
          sessionId: m.sessionId,
          projectPath,
          title: m.title,
          firstPrompt: m.firstPrompt,
          cwd: m.cwd,
          gitBranch: m.gitBranch,
          startedAtMs: m.startedAtMs,
          lastActiveAtMs: m.lastActiveAtMs,
          messageCount: m.messageCount,
          filePath: m.filePath,
          fileMtimeMs: m.fileMtimeMs,
          fileSize: m.fileSize,
          imported: auto,
        })
      }
    })
    run(metas)
  }

  allProjects(): StoredProject[] {
    return this.db.prepare<[], ProjectRow>('SELECT * FROM project ORDER BY path').all().map(toProject)
  }

  allSessions(): StoredSession[] {
    return this.db
      .prepare<[], SessionRow>('SELECT * FROM session ORDER BY last_active_ms DESC')
      .all()
      .map(toSession)
  }

  visibleSessions(): StoredSession[] {
    return this.db
      .prepare<[], SessionRow>(
        'SELECT * FROM session WHERE imported = 1 AND archived = 0 ORDER BY last_active_ms DESC',
      )
      .all()
      .map(toSession)
  }

  visibleProjects(): StoredProject[] {
    return this.db
      .prepare<[], ProjectRow>(`
        SELECT p.* FROM project p
        WHERE EXISTS (
          SELECT 1 FROM session s
          WHERE s.project_path = p.path AND s.imported = 1 AND s.archived = 0
        )
        ORDER BY p.path
      `)
      .all()
      .map(toProject)
  }

  /**
   * Looks up a project row by its canonical path. Used to validate a project identifier that
   * came from the renderer (e.g. the sidebar's "new session" button) before it is ever used as
   * a spawn cwd — the renderer's string is only trusted once it matches a row this store
   * already holds; an unknown path is rejected rather than spawned into.
   */
  getProject(path: string): StoredProject | null {
    const row = this.db.prepare<[string], ProjectRow>('SELECT * FROM project WHERE path = ?').get(path)
    return row ? toProject(row) : null
  }

  getSession(sessionId: string): StoredSession | null {
    const row = this.db
      .prepare<[string], SessionRow>('SELECT * FROM session WHERE session_id = ?')
      .get(sessionId)
    return row ? toSession(row) : null
  }

  /**
   * Marking a session imported also un-archives it: explicitly ticking a session in the Import
   * dialog is a deliberate "show this" action, so it overrides a prior delete (which only ever
   * sets `archived`, never touches `imported`) rather than leaving it invisible despite being
   * ticked. Marking a session *not* imported leaves `archived` untouched either way.
   */
  setImported(sessionIds: string[], imported: boolean): void {
    const stmt = this.db.prepare(
      imported
        ? 'UPDATE session SET imported = 1, archived = 0 WHERE session_id = ?'
        : 'UPDATE session SET imported = 0 WHERE session_id = ?',
    )
    const run = this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(id)
    })
    run(sessionIds)
  }

  setAutoImport(projectPath: string, enabled: boolean): void {
    this.db.prepare('UPDATE project SET auto_import = ? WHERE path = ?').run(enabled ? 1 : 0, projectPath)
  }

  setMessageCount(sessionId: string, count: number): void {
    this.db.prepare('UPDATE session SET message_count = ? WHERE session_id = ?').run(count, sessionId)
  }

  /** `null` clears a user-set title, reverting display back to whatever the scanner last read. */
  setCustomTitle(sessionId: string, title: string | null): void {
    this.db.prepare('UPDATE session SET custom_title = ? WHERE session_id = ?').run(title, sessionId)
  }

  /**
   * Hides (or restores) a session from every visible-session query, without touching the JSONL
   * file it was read from — `~/.claude/projects` is strictly read-only, so "deleting" a session
   * from Apiary only ever means removing it from view here. Re-importing the same session later
   * (it still shows up in Import Claude Sessions, since `allSessions()` ignores `archived`) clears
   * this back to visible.
   */
  setArchived(sessionId: string, archived: boolean): void {
    this.db.prepare('UPDATE session SET archived = ? WHERE session_id = ?').run(archived ? 1 : 0, sessionId)
  }

  close(): void {
    this.db.close()
  }
}
