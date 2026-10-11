/** The diagnostic log's own types — see CLAUDE.md "The diagnostic log" and `main/log/logger.ts`.
 *  Defined here, not mirrored, so a level added on one side cannot silently drift from the other
 *  (MAIN-22 / SHARED-2). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * The log's vocabulary of scopes, named once (SHARED-3) rather than left as a free `string` —
 * CLAUDE.md's "diagnostic log" section treats this list as the contract. `Logger.log` and its
 * `debug`/`info`/`warn`/`error` take a `LogScope`, as do the renderer's `logWrite` and the
 * scope-carrying helpers (`fireAndForget`, `launchDetached`, `createExec`), so a new scope is a
 * compile error until it is added here. `tests/unit/logScopes.test.ts` proves it.
 */
export type LogScope =
  | 'app' | 'auto-import' | 'chat' | 'claude-usage' | 'exec' | 'git' | 'gitlab-mr' | 'ipc' | 'layout'
  | 'live-sessions' | 'mr-status' | 'navigation' | 'pets' | 'process' | 'prompt' | 'pty' | 'refresh' | 'remote' | 'rename'
  | 'rescan' | 'resume' | 'search' | 'session-tracker' | 'settings' | 'shell' | 'status-bar' | 'tabs' | 'theme'
  | 'update' | 'usage' | 'vscode' | 'vscode-detect' | 'watcher' | 'window' | 'worktree-resolve'

/** Where the diagnostic logs are and how much room they take, for the Diagnostics section. */
export interface LogStatusPayload {
  enabled: boolean
  dir: string
  files: number
  bytes: number
}
