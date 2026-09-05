export const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS project (
  path         TEXT PRIMARY KEY,
  repo_root    TEXT,
  is_worktree  INTEGER NOT NULL DEFAULT 0,
  branch       TEXT,
  exists_flag  INTEGER NOT NULL DEFAULT 1,
  auto_import  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session (
  session_id       TEXT PRIMARY KEY,
  project_path     TEXT NOT NULL REFERENCES project(path),
  title            TEXT,
  custom_title     TEXT,
  first_prompt     TEXT,
  cwd              TEXT,
  git_branch       TEXT,
  started_at_ms    INTEGER,
  last_active_ms   INTEGER,
  message_count    INTEGER,
  file_path        TEXT NOT NULL,
  file_mtime_ms    INTEGER NOT NULL,
  file_size        INTEGER NOT NULL,
  imported         INTEGER NOT NULL DEFAULT 0,
  archived         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS session_by_project ON session(project_path);
CREATE INDEX IF NOT EXISTS session_by_imported ON session(imported, archived);
`
