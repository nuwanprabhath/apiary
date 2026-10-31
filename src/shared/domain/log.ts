/** The diagnostic log's types; see `main/log/logger.ts`. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * The log's vocabulary of scopes. Everything that takes a scope (`Logger.log`, `logWrite`,
 * `fireAndForget`, `launchDetached`, `createExec`) takes a `LogScope`, so a new scope is a compile
 * error until it is added here.
 */
export type LogScope =
  | 'accounts' | 'app' | 'auto-import' | 'chat' | 'claude-usage' | 'exec' | 'git' | 'gitlab-mr' | 'ipc' | 'knowledge' | 'layout'
  | 'library' | 'live-sessions' | 'mr-status' | 'navigation' | 'pets' | 'process' | 'prompt' | 'pty' | 'refresh' | 'remote' | 'rename'
  | 'rescan' | 'residents' | 'resume' | 'search' | 'session-tracker' | 'settings' | 'shell' | 'status-bar' | 'tabs' | 'theme'
  | 'update' | 'usage' | 'vscode' | 'vscode-detect' | 'watcher' | 'window' | 'worktree-resolve'

export interface LogStatusPayload {
  enabled: boolean
  dir: string
  files: number
  bytes: number
}
