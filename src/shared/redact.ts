/**
 * What a diagnostic log is allowed to contain.
 *
 * A log people are asked to send to someone else is a privacy decision before it is a debugging
 * tool, so the rule here is the strict one: **nothing is logged unless it was passed as a
 * structured field, and every string field goes through this.** Message text, prompts, transcript
 * contents and anything a user typed are never passed in the first place — no amount of scrubbing
 * makes a conversation safe to hand over, so it simply is not written.
 *
 * What this then removes from the things that *are* written:
 *
 * - **The user's name**, which is in nearly every path. `/Users/nuwan/projects/x` becomes
 *   `~/projects/x`: the shape of the path is the diagnostic value, the account name is not.
 * - **Credentials**, in the shapes they actually take — API keys, GitHub and GitLab tokens,
 *   bearer headers, `password=`/`token=` query parameters, and JWTs. Apiary stores no credential
 *   of its own (see the GitLab plugin's note on `glab`). The one it handles is Claude Code's
 *   sign-in token, which the usage plugin reads only after the user agreed, sends only to
 *   Anthropic's usage endpoint and never logs (ADR-0019). Anything matching these in a log got
 *   there by accident, which is exactly when redaction has to work.
 * - **Anything very long**, truncated. A field that grew without bound is how transcript text
 *   would end up in a log by mistake.
 *
 * Pure and in `shared/` so both processes redact identically.
 */

/** Longer than this and a field is a payload, not a diagnostic. */
const MAX_STRING = 512

/**
 * Secret shapes, checked before path rewriting so a token containing a slash is not mangled into
 * something that no longer matches. Each is deliberately narrow: a rule that redacts too much
 * makes the log useless, and a log nobody can read gets turned off.
 */
const SECRETS: { pattern: RegExp; as: string }[] = [
  { pattern: /\b(sk-ant-|sk-)[A-Za-z0-9_-]{16,}/g, as: '[redacted-api-key]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, as: '[redacted-github-token]' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, as: '[redacted-gitlab-token]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, as: '[redacted-jwt]' },
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, as: '$1 [redacted]' },
  { pattern: /\b(api[-_]?key|secret|password|passwd|token|auth)\s*[=:]\s*("?)[^\s"&,}]{4,}\2/gi, as: '$1=[redacted]' },
  // `scheme://user:password@host` — a git remote or a git failure that echoes one back
  // (`fatal: unable to access '...'`). Checked before HOME_LIKE, which does not touch URLs.
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, as: '$1[redacted]@' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, as: '[redacted-aws-key]' },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, as: '[redacted-slack-token]' },
  { pattern: /\bnpm_[A-Za-z0-9]{30,}/g, as: '[redacted-npm-token]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, as: '[redacted-private-key]' },
]

/**
 * Who someone is, in the shapes a log line carries it. A `user@host:` or `ssh://user@host` remote
 * loses its user, except the shared `git` account every forge uses, which names nobody. Users go
 * before emails so a remote is not mistaken for an address.
 */
const PEOPLE: { pattern: RegExp; as: string }[] = [
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)?(?!git@)\b[A-Za-z0-9._-]+@(?=[A-Za-z0-9.-]+[:/])/g, as: '$1[user]@' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b(?![:/\w.-])/g, as: '[email]' },
]

/** `/Users/someone/...`, `/home/someone/...`, `/var/home/someone/...` and `/root`, whoever they are. */
const HOME_LIKE = /(^|[\s"'(=])(\/(?:Users|home|var\/home)\/[^/\s"')]+|\/root\b)/g
/** `C:\Users\someone`. */
const WINDOWS_HOME = /(^|[\s"'(=])[A-Za-z]:\\Users\\[^\\\s"']+/g

export interface RedactOptions {
  /** The running user's home directory, rewritten to `~` wherever it appears. */
  home?: string
  /** Longest string kept; `MAX_STRING` unless a stricter caller asks for less. */
  max?: number
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Redacts one string: secrets first, then home directories, then length. */
export function redactString(value: string, { home, max = MAX_STRING }: RedactOptions = {}): string {
  let out = value
  for (const { pattern, as } of SECRETS) out = out.replace(pattern, as)
  for (const { pattern, as } of PEOPLE) out = out.replace(pattern, as)
  if (home !== undefined && home !== '') {
    out = out.replace(new RegExp(escapeRe(home), 'g'), '~')
  }
  // Any other account's home directory too: a worktree path from a session recorded on another
  // machine is still somebody's name.
  out = out.replace(HOME_LIKE, '$1~').replace(WINDOWS_HOME, '$1~')
  return out.length > max ? `${out.slice(0, max)}…[+${String(out.length - max)} chars]` : out
}

/**
 * Redacts a whole structured value, recursively. Anything that is not a string, number, boolean
 * or null is described rather than serialised: an unknown object is where something unintended
 * would hide. Cycles are cut rather than thrown on: a logger must never crash the app.
 */
export function redact(value: unknown, options: RedactOptions = {}, seen = new Set<unknown>()): unknown {
  if (typeof value === 'string') return redactString(value, options)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === undefined) return undefined
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message, options) }
  }
  if (typeof value !== 'object') return `[${typeof value}]`
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => redact(v, options, seen))
    return value.length > 50 ? [...items, `[+${String(value.length - 50)} more]`] : items
  }
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[key] = redact(v, options, seen)
  }
  return out
}
