import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type MrState = 'opened' | 'merged' | 'closed' | 'locked'

interface CacheEntry {
  at: number
  state: MrState | null
}

const TTL_MS = 10 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8000

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<MrState | null>>()
/** Set once `glab` itself is missing, so a bad install is not re-probed on every reference. */
let glabMissing = false

/** Test-only: clears every module-level cache so specs do not leak into each other. */
export function resetMrStatusCache(): void {
  cache.clear()
  inFlight.clear()
  glabMissing = false
}

async function defaultExec(file: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(file, args, { cwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
  return stdout
}

export interface ResolveMrStatusOptions {
  glabPath?: string
  /** Injected in tests; returns stdout or throws the way execFile does. */
  exec?: (file: string, args: string[], cwd: string) => Promise<string>
  now?: () => number
  timeoutMs?: number
}

const KNOWN_STATES: MrState[] = ['opened', 'merged', 'closed', 'locked']

function parseState(stdout: string): MrState | null {
  try {
    const payload = JSON.parse(stdout) as { state?: unknown }
    return typeof payload.state === 'string' && (KNOWN_STATES as string[]).includes(payload.state)
      ? (payload.state as MrState)
      : null
  } catch {
    return null
  }
}

/**
 * Looks up one merge request's state through `glab api`, the same "never hold a token" approach
 * as the session-bar plugin: Apiary asks `glab`, which already has the user's GitLab credentials,
 * and never sees one itself.
 *
 * Cached per host+project+iid for `TTL_MS`, with an in-flight map so a burst of references
 * resolving at once (a title and a note both naming `!1267`) makes one call, not two. Any failure
 * — no `glab`, not logged in, a 404, a timeout, malformed JSON — degrades to `null` silently; a
 * missing binary is additionally remembered so it is not re-tried for every other reference until
 * the process restarts.
 */
export async function resolveMrStatus(
  cwd: string,
  host: string,
  project: string,
  iid: number,
  options: ResolveMrStatusOptions = {},
): Promise<MrState | null> {
  if (glabMissing) return null

  const now = options.now ?? Date.now
  const key = `${host}|${project}|${iid}`

  const hit = cache.get(key)
  if (hit !== undefined && now() - hit.at < TTL_MS) return hit.state

  const running = inFlight.get(key)
  if (running !== undefined) return running

  const promise = lookup(cwd, host, project, iid, options)
  inFlight.set(key, promise)
  try {
    const state = await promise
    cache.set(key, { at: now(), state })
    return state
  } finally {
    inFlight.delete(key)
  }
}

async function lookup(
  cwd: string,
  host: string,
  project: string,
  iid: number,
  options: ResolveMrStatusOptions,
): Promise<MrState | null> {
  void host // part of the cache key, not of the command — the project path alone identifies it to glab
  const glab = options.glabPath ?? 'glab'
  const exec = options.exec ?? defaultExec
  try {
    const stdout = await exec(
      glab,
      ['api', `projects/${encodeURIComponent(project)}/merge_requests/${String(iid)}`],
      cwd,
    )
    return parseState(stdout)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') glabMissing = true
    return null
  }
}
