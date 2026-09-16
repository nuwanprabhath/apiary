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
 *   bearer headers, `password=`/`token=` query parameters, and JWTs. Apiary holds no credential
 *   of its own (see the GitLab plugin's note on `glab`), so anything matching these got here by
 *   accident, which is exactly when redaction has to work.
 * - **Anything very long**, truncated. A field that grew without bound is how transcript text
 *   would end up in a log by mistake.
 *
 * Kept pure and in `shared/` so both processes redact identically and so the rules are testable
 * without a filesystem — these are the assertions that decide whether the feature is safe.
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
]

/** `/Users/someone/...` and `/home/someone/...`, whoever they are. */
const HOME_LIKE = /(^|[\s"'(=])(\/(?:Users|home)\/[^/\s"')]+)/g

export interface RedactOptions {
  /** The running user's home directory, rewritten to `~` wherever it appears. */
  home?: string
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Redacts one string: secrets first, then home directories, then length. */
export function redactString(value: string, { home }: RedactOptions = {}): string {
  let out = value
  for (const { pattern, as } of SECRETS) out = out.replace(pattern, as)
  if (home !== undefined && home !== '') {
    out = out.replace(new RegExp(escapeRe(home), 'g'), '~')
  }
  // Any other account's home directory too: a worktree path from a session recorded on another
  // machine is still somebody's name.
  out = out.replace(HOME_LIKE, '$1~')
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[+${String(out.length - MAX_STRING)} chars]` : out
}

/**
 * Redacts a whole structured value, recursively.
 *
 * Objects and arrays are walked; anything that is not a string, number, boolean or null is
 * described rather than serialised, because "what type was it" is the useful part and an unknown
 * object is exactly where something unintended would hide. Cycles are cut rather than thrown on:
 * a logger must never be the thing that crashes the app.
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
    // Capped: a long array in a log line is a payload by another name.
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
