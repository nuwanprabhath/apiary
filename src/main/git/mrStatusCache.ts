import { createExec } from '../exec/run'
import { log } from '../log/logger'
import type { MrState } from '@shared/domain/git'

export type { MrState } from '@shared/domain/git'

interface CacheEntry {
  at: number
  state: MrState | null
}

/**
 * How long an answer is trusted, by what it says.
 *
 * An open merge request is the one whose state is expected to change — it gets merged, which is
 * the news a user watches for — so it is re-checked after two minutes. Merged and closed are final
 * in practice, and re-asking GitLab about them every few minutes is wasted calls. A null (lookup
 * failed) is retried soon, since the cause is often transient. It was ten minutes for everything,
 * which is how a merged `!1328` could keep saying "opened" long after the merge.
 */
function ttlFor(state: MrState | null): number {
  if (state === 'merged' || state === 'closed') return 60 * 60 * 1000
  if (state === null) return 60 * 1000
  return 2 * 60 * 1000
}

/** The `glab` runner a `MrStatusCache` is built with in the app: `exec/run.ts`'s `createExec`
 *  (MAIN-23), as `plugins/gitlabMr.ts` uses, not an `execFile` of its own. */
export function createMrExec(): MrExec {
  return createExec({ timeoutMs: 8000, maxBuffer: 1024 * 1024, scope: 'mr-status' })
}

type MrExec = (file: string, args: string[], cwd: string) => Promise<string>

interface ResolveMrStatusOptions {
  glabPath?: string
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

export interface MrStatusCacheOptions {
  /** Runs `glab`; returns stdout or throws the way execFile does. */
  exec: MrExec
  now?: () => number
}

/**
 * Looks up merge requests' state through `glab api`, the same "never hold a token" approach as the
 * session-bar plugin: Apiary asks `glab`, which already has the user's GitLab credentials, and
 * never sees one itself.
 *
 * Owns the answers (cached per host+project+iid, for the TTL `ttlFor` gives their state), the
 * in-flight map so a burst of references resolving at once (a title and a note both naming
 * `!1267`) makes one call, not two, and whether `glab` itself is missing. One instance, built in
 * the container; a test builds its own with a fake `exec` and clock.
 */
export class MrStatusCache {
  /** Invalidated by age: each entry expires after the TTL `ttlFor` gives its state. */
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<MrState | null>>()
  /** Set once `glab` itself is missing, so a bad install is not re-probed on every reference. */
  private glabMissing = false

  constructor(private readonly options: MrStatusCacheOptions) {}

  /**
   * Forgets every cached answer, so the next lookup asks GitLab again. What the Refresh button
   * does: someone pressing it has usually just merged something and wants to see it.
   */
  invalidate(): void {
    this.cache.clear()
  }

  /**
   * Cached per host+project+iid. Any failure — no `glab`, not logged in, a 404, a timeout,
   * malformed JSON — degrades to `null` silently; a missing binary is additionally remembered so
   * it is not re-tried for every other reference until the process restarts.
   */
  async resolve(
    cwd: string,
    host: string,
    project: string,
    iid: number,
    options: ResolveMrStatusOptions = {},
  ): Promise<MrState | null> {
    if (this.glabMissing) return null

    const now = this.options.now ?? Date.now
    const key = `${host}|${project}|${iid}`

    const hit = this.cache.get(key)
    if (hit !== undefined && now() - hit.at < ttlFor(hit.state)) return hit.state
    // Only fresh lookups are logged — a cached answer is served many times a minute. "Why does it
    // still say opened?" is answered by whether, and when, GitLab was last actually asked.

    const running = this.inFlight.get(key)
    if (running !== undefined) return running

    const promise = this.lookup(cwd, project, iid, options)
    this.inFlight.set(key, promise)
    try {
      const state = await promise
      this.cache.set(key, { at: now(), state })
      log.info('mr-status', 'looked up', { iid, state, stale: hit !== undefined ? hit.state : null })
      return state
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async lookup(cwd: string, project: string, iid: number, options: ResolveMrStatusOptions): Promise<MrState | null> {
    // `host` is part of the cache key, not of the command — the project path alone identifies it to glab
    const glab = options.glabPath ?? 'glab'
    try {
      const stdout = await this.options.exec(
        glab,
        ['api', `projects/${encodeURIComponent(project)}/merge_requests/${String(iid)}`],
        cwd,
      )
      return parseState(stdout)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') this.glabMissing = true
      return null
    }
  }
}
