/**
 * References to the things people remember a session by: merge requests, issues, ticket keys and
 * links. Pure and deterministic, so the index can be rebuilt from the JSONL and a pasted URL in a
 * question resolves to the same rows the transcript's own `!1175` wrote.
 */

import { ignoreErrors } from '@shared/ignoreErrors'

export type RefKind = 'mr' | 'issue' | 'ticket' | 'url'

export interface Ref {
  kind: RefKind
  value: string
}

/** Look like ticket keys and are not: encodings, hashes, standards. */
const NOT_A_TICKET = new Set([
  'UTF', 'SHA', 'ISO', 'MD', 'AES', 'RSA', 'TLS', 'SSL', 'RFC', 'CVE', 'HTTP', 'UTC', 'GPT', 'USB', 'IPV', 'ES', 'TCP', 'UDP',
])

const LINK_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi
const GITLAB_PATH = /^\/(.+?)\/-\/(merge_requests|issues)\/(\d+)(?:[/?#]|$)/
const GITHUB_PATH = /^\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)(?:[/?#]|$)/
const JIRA_PATH = /\/browse\/([A-Z][A-Z0-9]{1,9}-\d+)(?:[/?#]|$)/
const MR_MENTION = /(?<![\w!])!(\d{1,7})\b/g
const ISSUE_MENTION = /(?<![\w&/#])#(\d{1,7})\b/g
const TICKET_MENTION = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g

/** Lowercased host plus path without a trailing slash; no query string or fragment. */
function normaliseUrl(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.host.toLowerCase()}${path}`
}

function refsOfUrl(raw: string, add: (kind: RefKind, value: string) => void): void {
  const url = ignoreErrors(() => new URL(raw.replace(/[.,;:!?]+$/, '')), 'a malformed link is not a ref')
  if (url === undefined) return
  const path = ignoreErrors(() => decodeURIComponent(url.pathname), 'a bad escape keeps the raw path') ?? url.pathname
  const lab = GITLAB_PATH.exec(path)
  if (lab !== null) {
    const kind = lab[2] === 'merge_requests' ? 'mr' : 'issue'
    add(kind, `${lab[1]}${kind === 'mr' ? '!' : '#'}${lab[3]}`)
    add(kind, lab[3])
    return
  }
  const hub = GITHUB_PATH.exec(path)
  if (hub !== null) {
    const kind = hub[2] === 'pull' ? 'mr' : 'issue'
    add(kind, `${hub[1]}#${hub[3]}`)
    add(kind, hub[3])
    return
  }
  const jira = JIRA_PATH.exec(path)
  if (jira !== null) {
    add('ticket', jira[1])
    return
  }
  add('url', normaliseUrl(url))
}

/** Every reference in `text`, normalised and deduplicated, in order of first appearance. */
export function extractRefs(text: string): Ref[] {
  const seen = new Set<string>()
  const out: Ref[] = []
  const add = (kind: RefKind, value: string): void => {
    const key = `${kind}|${value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, value })
  }

  // URLs come out first, so their fragments and path numbers are not read again as mentions.
  const rest = text.replace(LINK_PATTERN, (url) => {
    refsOfUrl(url, add)
    return ' '
  })

  for (const m of rest.matchAll(MR_MENTION)) add('mr', m[1])
  for (const m of rest.matchAll(ISSUE_MENTION)) {
    // 6 and 8 digits read as a hex colour (#123456) far more often than as an issue number.
    if (m[1].length === 6 || m[1].length === 8) continue
    add('issue', m[1])
  }
  for (const m of rest.matchAll(TICKET_MENTION)) {
    const prefix = m[0].slice(0, m[0].indexOf('-'))
    if (!NOT_A_TICKET.has(prefix)) add('ticket', m[0])
  }
  return out
}

/** The references in a user's question: a pasted link finds the rows its `!n` mention wrote. */
export function refsInQuery(query: string): Ref[] {
  return extractRefs(query)
}
