/**
 * Which Claude session a running terminal is on right now, from Claude's own
 * `~/.claude/sessions/<pid>.json` — see `claudeSessionTracker.ts` in main.
 */
export interface PtySessionInfo {
  sessionId: string
  /** Claude's name for the session, or null when it has none. */
  name: string | null
  /** True when the user chose the name (`/rename`, `--name`) rather than Claude deriving one. */
  nameIsUser: boolean
  status: 'idle' | 'busy' | null
}

/** A pty's screen as escape sequences that repaint it, and the size they were laid out for. */
export interface PtySnapshot {
  data: string
  cols: number
  rows: number
}
