/**
 * The directory name Claude Code itself gives a cwd under ~/.claude/projects — every `/` and `.`
 * becomes `-`, verified against a live installation rather than assumed. It is lossy (a literal
 * `-` already in a path segment is indistinguishable from an encoded separator), which is exactly
 * why `CLAUDE.md` insists a session's cwd is read from inside its JSONL and never decoded back out
 * of this. This function only ever runs the encoding forwards, to find where Claude Code would
 * put a transcript for a cwd Apiary already resolved itself.
 */
export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}
