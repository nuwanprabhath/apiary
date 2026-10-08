import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Shared plumbing for the fitness-function tests in this folder (review §6.3/§6.4). Every test
 * here follows the same contract, which is what lets the allowlists only shrink:
 *
 * - an allowlist entry is `{ key, reason, debt?, ledger? }`; `reason` is mandatory, and an entry
 *   marked `"debt": true` must also name the ledger id (docs/reviews/2026-10-07-progress.md) of the
 *   work item that removes it;
 * - a finding with no entry fails the test (a NEW violation);
 * - an entry that matches no finding fails the test (a STALE entry — fix landed, delete the line).
 *   Same idea as eslint's unused-suppression error: without it, an allowlist only ever grows.
 */
export const ROOT = resolve(__dirname, '../../..')

export interface AllowEntry {
  key: string
  reason: string
  debt?: boolean
  ledger?: string
}

export function loadAllow(file: string): AllowEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(__dirname, file), 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${file}: expected an array of { key, reason, debt?, ledger? }`)
  const seen = new Set<string>()
  return raw.map((e: unknown, i) => {
    const entry = e as Partial<AllowEntry>
    const at = `${file}[${i}] (${String(entry.key)})`
    if (typeof entry.key !== 'string' || entry.key === '') throw new Error(`${at}: "key" is required`)
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') throw new Error(`${at}: "reason" is required`)
    if (entry.debt === true && !/^[A-Z]\d+$/.test(entry.ledger ?? '')) {
      throw new Error(`${at}: a debt entry must name the ledger id that removes it, e.g. "ledger": "B5"`)
    }
    if (seen.has(entry.key)) throw new Error(`${at}: duplicate key`)
    seen.add(entry.key)
    return entry as AllowEntry
  })
}

export interface Verdict {
  /** Findings with no allowlist entry: new violations. */
  unlisted: string[]
  /** Allowlist entries that matched no finding: delete them. */
  stale: string[]
}

export function judge(found: Iterable<string>, allow: AllowEntry[]): Verdict {
  const foundSet = new Set(found)
  const allowed = new Set(allow.map((a) => a.key))
  return {
    unlisted: [...foundSet].filter((k) => !allowed.has(k)).sort(),
    stale: allow.map((a) => a.key).filter((k) => !foundSet.has(k)),
  }
}

/** One message naming the stale entries, or none — an empty array is what the test asserts. */
export function staleReport(file: string, stale: string[]): string[] {
  return stale.length === 0 ? [] : [`${file} has entries that no longer match anything — delete them (the allowlist only shrinks): ${stale.join(', ')}`]
}

/** Files under `dirs` (relative to the repo root) with one of `exts`, as repo-relative posix paths. */
export function walk(dirs: string[], exts: string[], skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = []
  const visit = (rel: string): void => {
    for (const d of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${d.name}`
      if (d.name === 'node_modules' || skip(child)) continue
      if (d.isDirectory()) visit(child)
      else if (exts.some((e) => d.name.endsWith(e))) out.push(child)
    }
  }
  for (const d of dirs) visit(d)
  return out.sort()
}

export function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}
