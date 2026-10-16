import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProjectInfo, SessionMeta } from '@shared/types'
import { asSessionId } from '@shared/domain/ids'
import { SCHEMA } from './schema'

export interface StoredProject extends ProjectInfo {
  autoImport: boolean
}

export interface StoredSession extends SessionMeta {
  projectPath: string
  imported: boolean
  archived: boolean
  /** The user's own note about the session. Null when they have not written one. */
  note: string | null
}

interface ProjectRow {
  path: string; repo_root: string | null; is_worktree: number
  branch: string | null; exists_flag: number; auto_import: number
}

interface SessionRow {
  session_id: string; project_path: string; title: string | null
  custom_title: string | null
  note: string | null
  cwd_override: string | null
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
  sessionId: asSessionId(r.session_id),
  projectPath: r.project_path,
  // A user-set title wins over what the scanner read, or a rescan would revert a rename.
  title: r.custom_title ?? r.title,
  firstPrompt: r.first_prompt,
  // A move's override wins: the JSONL's recorded cwd never changes, so a rescan would undo the move.
  cwd: r.cwd_override ?? r.cwd,
  gitBranch: r.git_branch,
  startedAtMs: r.started_at_ms,
  lastActiveAtMs: r.last_active_ms,
  messageCount: r.message_count,
  filePath: r.file_path,
  fileMtimeMs: r.file_mtime_ms,
  fileSize: r.file_size,
  imported: r.imported === 1,
  archived: r.archived === 1,
  note: r.note,
})

export class SessionStore {
  private db: Database.Database
  // Prepared once, after `migrate()` has settled the schema; `getSession` sits behind `requireSession`, which most IPC handlers call.
  private readonly stmtUpsertProject: Database.Statement
  private readonly stmtUpsertSession: Database.Statement
  private readonly stmtGetSession: Database.Statement
  private readonly stmtGetProject: Database.Statement

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec(SCHEMA)
    this.migrate()

    this.stmtUpsertProject = this.db.prepare(`
      INSERT INTO project (path, repo_root, is_worktree, branch, exists_flag)
      VALUES (@path, @repoRoot, @isWorktree, @branch, @exists)
      ON CONFLICT(path) DO UPDATE SET
        repo_root = excluded.repo_root,
        is_worktree = excluded.is_worktree,
        branch = excluded.branch,
        exists_flag = excluded.exists_flag
    `)
    this.stmtUpsertSession = this.db.prepare(`
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
    this.stmtGetSession = this.db.prepare('SELECT * FROM session WHERE session_id = ?')
    this.stmtGetProject = this.db.prepare('SELECT * FROM project WHERE path = ?')
  }

  /**
   * `CREATE TABLE IF NOT EXISTS` in schema.ts only shapes a brand-new database, so a later column
   * needs an idempotent `ALTER TABLE` here, checked via `PRAGMA table_info` (no version counter).
   */
  private migrate(): void {
    const columns = this.db.prepare<[], { name: string }>('PRAGMA table_info(session)').all()
    if (!columns.some((c) => c.name === 'custom_title')) {
      this.db.exec('ALTER TABLE session ADD COLUMN custom_title TEXT')
    }
    if (!columns.some((c) => c.name === 'note')) {
      this.db.exec('ALTER TABLE session ADD COLUMN note TEXT')
    }
    if (!columns.some((c) => c.name === 'cwd_override')) {
      this.db.exec('ALTER TABLE session ADD COLUMN cwd_override TEXT')
    }
  }

  syncProject(info: ProjectInfo): void {
    this.stmtUpsertProject.run({
      path: info.path,
      repoRoot: info.repoRoot,
      isWorktree: info.isWorktree ? 1 : 0,
      branch: info.branch,
      exists: info.exists ? 1 : 0,
    })
  }

  private upsertSessionRows(projectPath: string, metas: SessionMeta[]): void {
    const auto = this.db
      .prepare<[string], { auto_import: number }>('SELECT auto_import FROM project WHERE path = ?')
      .get(projectPath)?.auto_import ?? 0
    for (const m of metas) {
      this.stmtUpsertSession.run({
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
  }

  /** Upserts metadata. Never clobbers `imported`; honours the project's auto-import flag for new rows. */
  syncSessions(projectPath: string, metas: SessionMeta[]): void {
    this.db.transaction(() => this.upsertSessionRows(projectPath, metas))()
  }

  /**
   * Syncs every project and its sessions from one refresh pass in a single commit.
   *
   * `syncProject`/`syncSessions` each open their own transaction (2P fsyncing commits for P
   * projects); one commit is faster, and a refresh that throws partway leaves no partial rows.
   */
  syncAll(entries: { info: ProjectInfo; metas: SessionMeta[] }[]): void {
    this.db.transaction(() => {
      for (const { info, metas } of entries) {
        this.syncProject(info)
        this.upsertSessionRows(info.path, metas)
      }
    })()
  }

  /**
   * Every known session's file size and mtime, keyed by transcript path; a scoped refresh checks
   * a freshly-`stat`ed file against it.
   */
  fileStamps(): Map<string, { size: number; mtimeMs: number }> {
    const rows = this.db
      .prepare<[], { file_path: string; file_size: number; file_mtime_ms: number }>(
        'SELECT file_path, file_size, file_mtime_ms FROM session',
      )
      .all()
    const out = new Map<string, { size: number; mtimeMs: number }>()
    for (const r of rows) out.set(r.file_path, { size: r.file_size, mtimeMs: r.file_mtime_ms })
    return out
  }

  /** Every distinct raw cwd recorded for a session — what a `full` refresh re-resolves. */
  distinctCwds(): string[] {
    return this.db
      .prepare<[], { cwd: string }>('SELECT DISTINCT cwd FROM session WHERE cwd IS NOT NULL')
      .all()
      .map((r) => r.cwd)
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
   * Looks up a project row by canonical path. Validates a renderer-supplied project identifier
   * before it is used as a spawn cwd: only a path matching a stored row is trusted.
   */
  getProject(path: string): StoredProject | null {
    const row = this.stmtGetProject.get(path) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  /**
   * Whether `path` is the repository some stored worktree belongs to; the tree draws it as a
   * heading even with no project row of its own.
   */
  isRepoRootOfWorktree(path: string): boolean {
    return this.db
      .prepare<[string], { one: number }>('SELECT 1 AS one FROM project WHERE is_worktree = 1 AND repo_root = ? LIMIT 1')
      .get(path) !== undefined
  }

  getSession(sessionId: string): StoredSession | null {
    const row = this.stmtGetSession.get(sessionId) as SessionRow | undefined
    return row ? toSession(row) : null
  }

  /**
   * Marking a session imported also un-archives it: ticking it in the Import dialog overrides a
   * prior delete (which only sets `archived`). Marking it *not* imported leaves `archived` alone.
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

  /**
   * The user's note for a session; `null` removes it.
   *
   * Kept here, not in the search index: it is the one thing that cannot be rebuilt from
   * `~/.claude/projects`. The index gets a copy.
   */
  setNote(sessionId: string, note: string | null): void {
    this.db.prepare('UPDATE session SET note = ? WHERE session_id = ?').run(note, sessionId)
  }

  /** Every session that has a note, for populating the index. */
  sessionsWithNotes(): { sessionId: string; note: string }[] {
    return this.db
      .prepare<[], { session_id: string; note: string }>(
        "SELECT session_id, note FROM session WHERE note IS NOT NULL AND note != ''",
      )
      .all()
      .map((r) => ({ sessionId: r.session_id, note: r.note }))
  }

  /** `null` clears a user-set title, reverting display back to whatever the scanner last read. */
  setCustomTitle(sessionId: string, title: string | null): void {
    this.db.prepare('UPDATE session SET custom_title = ? WHERE session_id = ?').run(title, sessionId)
  }

  /**
   * Records that a session's transcript now lives under a different project. `syncSessions` never
   * writes `cwd_override` or `project_path`, so a rescan cannot undo this. `file_path` is set
   * here too so the session is resumable the instant this returns.
   */
  recordSessionMove(sessionId: string, projectPath: string, cwd: string, filePath: string): void {
    this.db.prepare(
      'UPDATE session SET project_path = ?, cwd_override = ?, file_path = ? WHERE session_id = ?',
    ).run(projectPath, cwd, filePath, sessionId)
  }

  /**
   * Hides (or restores) a session from every visible-session query; `~/.claude/projects` is
   * read-only, so "deleting" only removes it from view. Re-importing (`allSessions()` ignores
   * `archived`) clears it.
   */
  setArchived(sessionId: string, archived: boolean): void {
    this.db.prepare('UPDATE session SET archived = ? WHERE session_id = ?').run(archived ? 1 : 0, sessionId)
  }

  /** The account a session runs under, or null when none was ever chosen (the default applies). */
  getSessionAccount(sessionId: string): string | null {
    const row = this.db.prepare<[string], { account_id: string }>('SELECT account_id FROM session_account WHERE session_id = ?').get(sessionId)
    return row?.account_id ?? null
  }

  setSessionAccount(sessionId: string, accountId: string): void {
    this.db.prepare(`
      INSERT INTO session_account (session_id, account_id) VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET account_id = excluded.account_id
    `).run(sessionId, accountId)
  }

  close(): void {
    this.db.close()
  }
}
