/** The diagnostic log's own types — see CLAUDE.md "The diagnostic log" and `main/log/logger.ts`.
 *  Defined here, not mirrored, so a level added on one side cannot silently drift from the other
 *  (MAIN-22 / SHARED-2). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * The log's vocabulary of scopes, named once (SHARED-3) rather than left as a free `string` —
 * CLAUDE.md's "diagnostic log" section already treats this list as the contract. Used to type the
 * renderer's side of `logWrite`, the one entry point where an arbitrary caller (any component)
 * picks the scope; main's own `log.info`/`log.warn` call sites are not retyped, since main also
 * logs ad hoc detail scopes (`mr-status`, `session-tracker`) that are already covered here.
 */
export type LogScope =
  | 'app' | 'git' | 'ipc' | 'mr-status' | 'navigation' | 'process' | 'prompt' | 'pty' | 'refresh'
  | 'rename' | 'resume' | 'search' | 'session-tracker' | 'settings' | 'shell' | 'status-bar' | 'tabs' | 'theme'
  | 'usage'
  | 'update' | 'vscode' | 'window'

/** Where the diagnostic logs are and how much room they take, for the Diagnostics section. */
export interface LogStatusPayload {
  enabled: boolean
  dir: string
  files: number
  bytes: number
}
