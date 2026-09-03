# Apiary — Design

**Date:** 2026-09-03
**Status:** Approved, ready for planning

## Problem

Claude Code sessions are scattered across project folders and git worktrees. Resuming one means remembering which directory it lived in, opening that workspace, and hunting through `claude --resume`'s picker. With several worktrees per repo and more than one session per worktree, finding the right conversation is the slow part.

Apiary is a desktop app that lists every Claude Code session in one place, grouped by the folder it started in, searchable by title, and resumable in-app.

## Goals

- One window listing all imported sessions, grouped repo → worktree → session.
- Search sessions by title, folder and branch.
- Click a session to read its full history as a chat transcript.
- Resume a session in an embedded terminal, in the correct working directory.
- Explicit import step so the sidebar shows only what the user chose.
- Runs on macOS and Ubuntu 24.04.

## Non-goals (v1)

- Full-text search over message bodies. The schema leaves room; the indexer is deferred.
- Starting brand-new sessions from Apiary.
- Editing or deleting sessions.
- Remote or multi-machine sync.
- Any file tree or code editor in the centre pane. The transcript and terminal are the workspace.
- Embedding the Claude Code VS Code extension. It is a closed extension hosted by VS Code and cannot be loaded into a third-party window.

## Data source

Claude Code stores sessions as JSONL at `~/.claude/projects/<path-slug>/<session-uuid>.jsonl`, or under `$CLAUDE_CONFIG_DIR` when set.

### The slug is lossy — never decode it

The directory name is the working directory with separators replaced by `-`. Both `/` and `.` collapse to the same character, so the transform is not invertible:

| Directory slug | Actual cwd |
|---|---|
| `-Users-nuwan-projects-paratoo-fdcp-worktrees-1-0-11` | `/Users/nuwan/projects/paratoo-fdcp.worktrees/1.0.11` |

Reversing the slug yields `/Users/nuwan/projects/paratoo-fdcp/worktrees/1.0.11`, which does not exist. Apiary reads the authoritative `cwd` field from inside the JSONL and never derives a path from the directory name. This is a correctness requirement, not an optimisation: getting it wrong resumes a session in the wrong directory.

### Relevant JSONL entry types

Each line is a self-contained JSON object with a `type` field. Observed types include `user`, `assistant`, `attachment`, `ai-title`, `queue-operation`, `file-history-snapshot`, `last-prompt`, `atis-latch`, `mode`.

- `user` / `assistant` carry `message`, plus `cwd`, `gitBranch`, `sessionId`, `timestamp`, `version`, `isSidechain`.
- `ai-title` carries `{"type":"ai-title","aiTitle":"...","sessionId":"..."}` and is rewritten on most turns. The most recent occurrence is the session title. Every session observed on this machine has one, so titles need no model call.
- Everything else is ignored by the transcript renderer.

## Architecture

Electron, two processes, context isolation enabled. The renderer has no Node integration; it reaches the main process through a typed preload bridge. All filesystem, git, database and PTY work lives in main.

Stack: Electron + `xterm.js` + `node-pty` + `better-sqlite3` + `chokidar`, packaged with `electron-builder`.

`node-pty` and `xterm.js` are the same PTY and terminal layers VS Code uses, so the embedded session behaves like a real terminal — 256 colour, resize, mouse. Tauri was considered and rejected: a smaller binary is not worth hand-writing the PTY bridge in Rust when the terminal is the core feature. A localhost web app was rejected for having no native menu bar and for exposing PTY spawn on an open port.

### Modules

Each module has one job and is testable without the others.

**`SessionScanner`** — discovers sessions and extracts metadata.
Walks `~/.claude/projects/*/` for `*.jsonl`. Session files reach 11MB (~90MB total on the reference machine), so it never parses a whole file for metadata:

- Read the first ~64KB → `cwd`, `gitBranch`, `version`, first real user prompt, start timestamp.
- Read the last ~64KB → newest `ai-title`, last timestamp.
- Both boundary reads discard the partial line at the cut.
- If no `ai-title` appears in the tail, fall back to a streaming scan of the file.
- Cache key is `(mtime, size)`, so rescans of unchanged files cost nothing.

Input: a config root. Output: plain metadata records. No database or UI knowledge.

**`WorktreeResolver`** — classifies a project path.
Runs `git rev-parse --git-common-dir` in the path. When the common dir is not `<path>/.git`, the path is a worktree and its owning repo is the common dir's parent. Also resolves the current branch. Results are cached per path; paths that no longer exist are marked stale rather than dropped.

Input: an absolute path. Output: `{ repoRoot, isWorktree, branch, exists }`.

**`SessionStore`** — persistence and queries, SQLite via `better-sqlite3`.

- `project(id, path, display_name, repo_root, is_worktree, branch, imported_at, stale)`
- `session(id TEXT PRIMARY KEY, project_id, title, first_prompt, started_at, last_active_at, message_count, file_path, file_mtime, file_size, imported, archived)`

Message bodies stay out of the database in v1. The schema is shaped so an FTS5 virtual table over message text can be attached later without migrating existing tables.

Input: metadata records and queries. Output: the tree and search results the sidebar renders.

**`TranscriptReader`** — turns a JSONL file into renderable messages.
Streams the file, keeps `user` and `assistant` entries, maps assistant content blocks (`text`, `thinking`, `tool_use`) and user `tool_result` blocks into a normalised message shape. Corrupt or truncated lines are skipped and counted. Supports reading the last N messages with paging upward, so multi-thousand-turn sessions open instantly.

**`PtyManager`** — owns terminal processes.
Spawns through `node-pty`, tracks sessions by id, forwards data and resize both ways, and reports exit codes.

**`LiveSessionDetector`** — finds sessions already open elsewhere.
Scans `ps -eo pid,args` for Claude processes and extracts `--resume=<id>`. A session opened without `--resume` cannot be attributed to an id; those are treated as unknown rather than guessed at. Used to mark live sessions in the sidebar and to warn before resuming.

**Watcher** — `chokidar` on the config root. New session files inside an already-imported project appear in the sidebar without a restart.

## UI

Three regions in one window.

**Left — session tree.** Repo → worktree → session. Worktrees nest under their parent repo, labelled by branch; non-worktree folders sit flat at the top level. Sessions show title, relative last-active time, and a dot when `LiveSessionDetector` reports them running. The search box fuzzy-matches title, folder path and branch, flattening the tree to matches as you type.

**Centre — transcript.** The session rendered as a chat view: user and assistant turns, thinking blocks collapsed by default, tool calls as compact expandable rows, edits shown as diffs. Virtualised; loads the most recent 200 messages with "load earlier" upward. Sidechain (subagent) traffic hidden behind a toggle. A tab strip lets the transcript and a resumed terminal coexist, so switching back to history does not kill the session.

**Bottom — shell terminal.** Collapsible, runs the user's shell in the session's cwd, independent of Claude.

**Menus.** Native menu bar. `File → Import Claude Sessions…` opens a modal listing every discovered session grouped by folder, with a search field, per-session checkboxes and per-folder select-all. Confirming sets `imported = 1`. Only imported projects appear in the sidebar; new sessions inside an imported project appear automatically.

Window bounds, expanded folders, selected session and pane sizes persist between launches.

## Resume flow

1. User clicks **Resume** in the transcript header.
2. `LiveSessionDetector` checks for an existing process holding that session id.
3. If one exists, the user chooses **Open anyway** or **Fork**. Fork is the recommended action and runs `claude --resume <id> --fork-session`, branching to a new session id and leaving the original untouched.
4. `PtyManager` spawns `$SHELL -l -c 'exec claude --resume <id>'` with `cwd` set to the session's recorded `cwd` and `TERM=xterm-256color`.

Going through the login shell is deliberate: it picks up nvm, homebrew and anything else that puts `claude` on `PATH`, and behaves the same on macOS and Ubuntu.

The PTY resizes with its pane. On exit the terminal remains, showing the exit status, rather than disappearing.

## Error handling

| Condition | Behaviour |
|---|---|
| Session cwd no longer exists (deleted worktree) | Session stays visible, greyed; resume disabled with a "folder is gone" note |
| `claude` not on `PATH` | Actionable message offering a settings field for an explicit binary path |
| Corrupt or truncated JSONL lines | Skipped and counted; transcript still renders, count shown |
| `~/.claude/projects` missing | Empty state explaining where Apiary looks and how to override with `CLAUDE_CONFIG_DIR` |
| PTY spawn failure | Surfaced in the terminal pane with the underlying error |

## Testing

**Unit**
- `SessionScanner` against fixture JSONLs: tail read landing mid-line, absent `ai-title`, corrupt lines, a multi-MB file, a file with only `queue-operation` entries.
- `WorktreeResolver` against a real temp repo created with `git worktree add`.
- A regression test asserting no code path derives a filesystem path from the directory slug. The `paratoo-fdcp.worktrees/1.0.11` case is the fixture.
- `TranscriptReader` block mapping and paging.

**Integration**
- `SessionStore` through import, rescan and watcher-triggered insert.

**End-to-end** (Playwright's Electron support)
- Launch, import a fixture project, open a session, assert the transcript renders.
- Resume against a stub `claude` script on `PATH`; assert the PTY spawns with the correct cwd and echoes.

## Packaging

Single `electron-builder` config producing `.dmg` (arm64 and x64) for macOS and `.AppImage` plus `.deb` for Ubuntu 24.04. `better-sqlite3` and `node-pty` are native modules, so CI builds each platform on its own runner via `electron-rebuild`.
