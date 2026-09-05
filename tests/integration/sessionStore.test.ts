import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SessionStore } from '../../src/main/store/sessionStore'
import type { SessionMeta, ProjectInfo } from '@shared/types'

let dir: string
let store: SessionStore

const project = (path: string): ProjectInfo => ({
  path, repoRoot: path, isWorktree: false, branch: 'main', exists: true,
})

const meta = (id: string, cwd: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  sessionId: id,
  filePath: `${cwd}/.jsonl/${id}.jsonl`,
  fileMtimeMs: 1000,
  fileSize: 500,
  cwd,
  gitBranch: 'main',
  title: `Title ${id}`,
  firstPrompt: 'hello',
  startedAtMs: 900,
  lastActiveAtMs: 1000,
  messageCount: null,
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-db-'))
  store = new SessionStore(join(dir, 'apiary.db'))
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('SessionStore', () => {
  it('stores projects and sessions, hidden until imported', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    expect(store.allSessions()).toHaveLength(1)
    expect(store.visibleSessions()).toHaveLength(0)
    expect(store.visibleProjects()).toHaveLength(0)
  })

  it('shows a session and its project once imported', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.setImported(['s1'], true)
    expect(store.visibleSessions().map((s) => s.sessionId)).toEqual(['s1'])
    expect(store.visibleProjects().map((p) => p.path)).toEqual(['/home/nuwan/app'])
  })

  it('visibleProjects only returns projects whose own session is imported', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncProject(project('/home/nuwan/other'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.syncSessions('/home/nuwan/other', [meta('s2', '/home/nuwan/other')])
    store.setImported(['s1'], true)
    expect(store.visibleProjects().map((p) => p.path)).toEqual(['/home/nuwan/app'])

    store.setImported(['s2'], true)
    expect(store.visibleProjects().map((p) => p.path)).toEqual(['/home/nuwan/app', '/home/nuwan/other'])
  })

  it('auto-imports new sessions in an auto-import project', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.setAutoImport('/home/nuwan/app', true)
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    expect(store.visibleSessions().map((s) => s.sessionId)).toEqual(['s1'])
  })

  it('does not auto-import into a project without the flag', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    expect(store.visibleSessions()).toHaveLength(0)
  })

  it('updates changed metadata on rescan without losing the imported flag', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.setImported(['s1'], true)
    store.syncSessions('/home/nuwan/app', [
      meta('s1', '/home/nuwan/app', { title: 'Renamed', fileSize: 900, lastActiveAtMs: 2000 }),
    ])
    const s = store.getSession('s1')!
    expect(s.title).toBe('Renamed')
    expect(s.fileSize).toBe(900)
    expect(s.imported).toBe(true)
  })

  it('records a computed message count', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.setMessageCount('s1', 142)
    expect(store.getSession('s1')!.messageCount).toBe(142)
  })

  it('persists across reopen', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.setImported(['s1'], true)
    store.close()
    const reopened = new SessionStore(join(dir, 'apiary.db'))
    expect(reopened.visibleSessions()).toHaveLength(1)
    reopened.close()
    store = new SessionStore(join(dir, 'apiary.db'))
  })

  it('archiving a session hides it without touching imported, and re-importing un-archives it', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app')])
    store.setImported(['s1'], true)
    expect(store.visibleSessions()).toHaveLength(1)

    store.setArchived('s1', true)
    expect(store.visibleSessions()).toHaveLength(0)
    // Still discoverable (e.g. by the Import dialog) and still marked imported underneath —
    // archiving is purely a visibility flag, not an undo of the import itself.
    expect(store.allSessions()).toHaveLength(1)
    expect(store.getSession('s1')!.imported).toBe(true)

    // A rescan picking up unrelated metadata changes must not un-archive it by accident.
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app', { fileSize: 999 })])
    expect(store.visibleSessions()).toHaveLength(0)

    // Explicitly re-importing it (ticking it in the Import dialog again) is the one thing that
    // brings it back.
    store.setImported(['s1'], true)
    expect(store.visibleSessions()).toHaveLength(1)
  })

  it('marks a project stale when its directory is gone', () => {
    store.syncProject({ ...project('/home/nuwan/gone'), exists: false })
    expect(store.allProjects()[0].exists).toBe(false)
  })

  it('a custom title overrides the scanned one, and survives a rescan', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app', { title: 'Scanned title' })])
    store.setCustomTitle('s1', 'My renamed session')
    expect(store.getSession('s1')!.title).toBe('My renamed session')

    // A later rescan (e.g. Claude eventually writing its own `ai-title`) must not silently
    // revert the rename — syncSessions only ever writes the scanned `title` column, never
    // `custom_title`.
    store.syncSessions('/home/nuwan/app', [
      meta('s1', '/home/nuwan/app', { title: 'A different scanned title' }),
    ])
    expect(store.getSession('s1')!.title).toBe('My renamed session')
  })

  it('clearing a custom title reverts display back to the scanned one', () => {
    store.syncProject(project('/home/nuwan/app'))
    store.syncSessions('/home/nuwan/app', [meta('s1', '/home/nuwan/app', { title: 'Scanned title' })])
    store.setCustomTitle('s1', 'Renamed')
    store.setCustomTitle('s1', null)
    expect(store.getSession('s1')!.title).toBe('Scanned title')
  })

  // Regression test: `custom_title` was added to the schema after the `session` table already
  // existed in the wild. `CREATE TABLE IF NOT EXISTS` alone leaves an already-existing table
  // untouched, so opening a database file created before this column existed must not crash (nor
  // silently behave as if every session had no custom title support at all) — it needs the
  // explicit `ALTER TABLE` migration in the constructor to actually run.
  it('adds custom_title via migration when opening a database created before that column existed', () => {
    store.close()
    const dbPath = join(dir, 'apiary.db')
    rmSync(dbPath, { force: true })

    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE project (
        path TEXT PRIMARY KEY, repo_root TEXT, is_worktree INTEGER NOT NULL DEFAULT 0,
        branch TEXT, exists_flag INTEGER NOT NULL DEFAULT 1, auto_import INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE session (
        session_id TEXT PRIMARY KEY, project_path TEXT NOT NULL REFERENCES project(path),
        title TEXT, first_prompt TEXT, cwd TEXT, git_branch TEXT,
        started_at_ms INTEGER, last_active_ms INTEGER, message_count INTEGER,
        file_path TEXT NOT NULL, file_mtime_ms INTEGER NOT NULL, file_size INTEGER NOT NULL,
        imported INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
      );
    `)
    raw.prepare(`
      INSERT INTO project (path, repo_root, branch) VALUES ('/home/nuwan/app', '/home/nuwan/app', 'main')
    `).run()
    raw.prepare(`
      INSERT INTO session (session_id, project_path, title, file_path, file_mtime_ms, file_size)
      VALUES ('s1', '/home/nuwan/app', 'Pre-migration title', '/x.jsonl', 1000, 500)
    `).run()
    raw.close()

    const reopened = new SessionStore(dbPath)
    expect(reopened.getSession('s1')!.title).toBe('Pre-migration title')
    reopened.setCustomTitle('s1', 'Renamed after migration')
    expect(reopened.getSession('s1')!.title).toBe('Renamed after migration')
    reopened.close()
    store = new SessionStore(dbPath) // afterEach expects `store` to be a live, closeable handle
  })
})
