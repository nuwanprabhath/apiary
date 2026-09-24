/**
 * Variables a running Claude Code session sets for *its own* children, which must not leak into
 * the sessions Apiary starts.
 *
 * Apiary inherits its environment from whatever launched it. Launched from a shell that Claude
 * Code itself opened — `npm start` typed in a Claude terminal, or a VS Code window with the Claude
 * extension — that environment carries the parent session's markers, and every `claude` Apiary
 * then starts believes it is a sub-process of that other session. The visible consequence,
 * measured: `CLAUDE_CODE_CHILD_SESSION` makes the child print "Transcript saving is off" and write
 * no JSONL and no `~/.claude/sessions/<pid>.json` at all. With nothing written, a new or forked
 * session's tab can never be matched to a session id, and stays a `new:<uuid>` pty forever —
 * unpinnable, missing from Recent, untitled in Active, and unforkable.
 *
 * An explicit list rather than every `CLAUDE_CODE_*`: `CLAUDE_CODE_USE_BEDROCK`,
 * `CLAUDE_CODE_USE_VERTEX` and similar are real user configuration and must keep reaching Claude.
 * Sessions run in a login shell (`-l -c`), so anything a user deliberately sets in their profile is
 * set again there regardless.
 */
export const INHERITED_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
] as const

/** The environment a pty child gets: the parent's, minus another session's markers, plus `extra`. */
export function childEnv(
  parent: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  const drop = new Set<string>(INHERITED_SESSION_MARKERS)
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && !drop.has(k)) out[k] = v
  }
  return { ...out, TERM: 'xterm-256color', ...extra }
}

/** Which markers were present and removed — logged, so a stripped launch is visible after the fact. */
export function strippedMarkers(parent: NodeJS.ProcessEnv): string[] {
  return INHERITED_SESSION_MARKERS.filter((k) => parent[k] !== undefined)
}
