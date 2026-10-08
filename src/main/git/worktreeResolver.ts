import { access, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createExec, type ExecFn } from '../exec/run'
import type { ProjectInfo } from '@shared/types'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { branchFromRef } from './refs'

export interface WorktreeResolverOptions {
  /**
   * Runs `git`. MAIN-23: the same `createExec` wrapper `BranchOps` uses, at this module's own 5s
   * timeout — unlike `BranchOps`, a failure here is swallowed to `null` (best-effort project
   * detection), never thrown, so `createExec`'s normalised error text is simply discarded. Injected
   * (the container builds the real one) so a test can pin that null-on-failure contract without a
   * git repository.
   */
  exec: ExecFn
}

/** The 5 s `git` runner a `WorktreeResolver` is built with in the app. */
export function createResolverExec(): ExecFn {
  return createExec({ timeoutMs: 5000, scope: 'worktree-resolve' })
}

/**
 * Resolves a folder to its project: repository root, worktree or not, branch. Owns the cache of
 * answers and the count of `git` spawns it cost — the "measure before fixing"
 * number for MAIN-1 and MAIN-3: a cache hit costs none, and the single-spawn rewrite in MAIN-3 made
 * an uncached folder cost 2 rather than 3. One instance, built in the container; a test builds its own.
 *
 * The cache states its invalidation: an answer is stored with the fingerprint of the folder's
 * `HEAD` file (the one a `git checkout` rewrites, in `.git` or in `.git/worktrees/<name>` for a
 * linked worktree), and is used only while that fingerprint is unchanged. A checkout done outside
 * Apiary therefore shows on the next scoped pass, with no full pass needed. `forceResolve` and
 * `clearCache` remain for a caller that knows better (a worktree removed, a mutation Apiary made).
 */
interface CacheEntry {
  info: ProjectInfo
  /** The `HEAD` file this answer was read beside and its fingerprint then; null when the folder is
   *  not a repository (or exec gave no git dir), which has no key and so stays cached as before. */
  head: { file: string; stamp: string } | null
}

/** Changes whenever git rewrites HEAD: it writes a lock file and renames it over HEAD, so the
 *  inode moves even when two checkouts land in the same clock tick. */
async function headStamp(file: string): Promise<string | null> {
  try {
    const st = await stat(file)
    return `${String(st.mtimeMs)}:${String(st.size)}:${String(st.ino)}`
  } catch {
    return null
  }
}

export class WorktreeResolver {
  /** Invalidated by the folder's HEAD fingerprint (see the class note), `forceResolve` and `clearCache`. */
  private readonly cache = new Map<string, CacheEntry>()
  private spawns = 0

  constructor(private readonly options: WorktreeResolverOptions) {}

  clearCache(): void {
    this.cache.clear()
  }

  /** `git` spawns since the last reset. */
  spawnCount(): number { return this.spawns }
  resetSpawnCount(): void { this.spawns = 0 }

  private async git(cwd: string, args: string[]): Promise<string | null> {
    this.spawns += 1
    try {
      const stdout = await this.options.exec('git', args, cwd)
      return stdout.trim()
    } catch {
      return null
    }
  }

  async resolveProject(
    path: string,
    opts?: { /** Bypasses the cache — used right after a mutation that is the reason it's stale (MAIN-4). */ forceResolve?: boolean },
  ): Promise<ProjectInfo> {
    const cache = this.cache
    const cached = opts?.forceResolve ? undefined : cache.get(path)
    if (cached) {
      // A HEAD that cannot be read any more (the worktree was removed) is as stale as a changed one.
      if (cached.head === null || (await headStamp(cached.head.file)) === cached.head.stamp) return cached.info
    }

    let exists = true
    try {
      await access(path)
    } catch {
      exists = false
    }

    // Canonicalize once and work in that domain throughout: git always resolves symlinks in
    // the absolute paths it reports (--show-toplevel, and --git-common-dir for a worktree), so
    // comparing against a symlinked `path` produces false-positive worktree detection, and
    // returning a symlinked `path`/`repoRoot` would make a worktree's repoRoot uncomparable to
    // its parent project's own (canonical) path. Fall back to the raw path when it doesn't
    // exist — realpath throws in that case, and exists:false must not change.
    const canonicalPath = exists ? (await ignoreErrorsAsync(() => realpath(path), 'realpath can fail on a path that just vanished')) ?? path : path

    let info: ProjectInfo = { path: canonicalPath, repoRoot: null, isWorktree: false, branch: null, exists }
    let head: CacheEntry['head'] = null

    if (exists) {
      // One spawn instead of two: git prints both answers, one per line, for a single call.
      const both = await this.git(canonicalPath, ['rev-parse', '--git-common-dir', '--show-toplevel', '--absolute-git-dir'])
      const [commonDir, topLevel, gitDir] = both ? both.split('\n') : [undefined, undefined, undefined]
      if (commonDir && topLevel) {
        // --git-common-dir is relative to cwd for a plain repo, absolute for a worktree.
        const absCommon = isAbsolute(commonDir) ? commonDir : resolve(canonicalPath, commonDir)
        const repoRoot = dirname(absCommon)
        const isWorktree = absCommon !== join(topLevel, '.git')
        // `symbolic-ref` (unlike `rev-parse --abbrev-ref HEAD`) also succeeds on an unborn branch
        // (a freshly `git init`ed repo with no commits yet), and fails on a detached HEAD exactly
        // as the old call did — both map to `branch: null` below, same as before.
        // Fingerprinted before the branch is read: a checkout between the two makes the stored
        // stamp older than the answer, so the next lookup re-resolves rather than trusting it.
        if (gitDir) {
          const file = join(gitDir, 'HEAD')
          const stamp = await headStamp(file)
          if (stamp !== null) head = { file, stamp }
        }
        const headRef = await this.git(canonicalPath, ['symbolic-ref', '-q', 'HEAD'])
        const branch = headRef === null ? null : branchFromRef(headRef)
        info = {
          path: canonicalPath,
          repoRoot: isWorktree ? repoRoot : topLevel,
          isWorktree,
          branch,
          exists,
        }
      }
    }

    cache.set(path, { info, head })
    return info
  }
}
