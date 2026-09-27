import { access, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createExec, type ExecFn } from '../exec/run'
import type { ProjectInfo } from '@shared/types'

const cache = new Map<string, ProjectInfo>()

export function clearResolverCache(): void {
  cache.clear()
}

/**
 * Counts actual `git` spawns since the last reset — the "measure before fixing" number for MAIN-1
 * and MAIN-3: a cache hit in `resolveProject` costs none of these, and the single-spawn rewrite in
 * MAIN-3 means an uncached folder now costs 2 rather than 3.
 */
let spawnCount = 0
export function resolverSpawnCount(): number { return spawnCount }
export function resetResolverSpawnCount(): void { spawnCount = 0 }

/**
 * MAIN-23: same `createExec` wrapper `branchOps.ts` uses, at this module's own 5s timeout —
 * unlike `branchOps.git()`, a failure here is swallowed to `null` (best-effort project detection),
 * never thrown, so `createExec`'s normalised error text is simply discarded. Injectable so
 * `tests/unit/worktreeResolverExec.test.ts` can pin that null-on-failure contract without a real
 * git repository.
 */
let execGit: ExecFn = createExec({ timeoutMs: 5000, scope: 'worktree-resolve' })
export function setExecForTesting(fn: ExecFn | null): void {
  execGit = fn ?? createExec({ timeoutMs: 5000, scope: 'worktree-resolve' })
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  spawnCount += 1
  try {
    const stdout = await execGit('git', args, cwd)
    return stdout.trim()
  } catch {
    return null
  }
}

export async function resolveProject(
  path: string,
  opts?: { /** Bypasses the cache — used right after a mutation that is the reason it's stale (MAIN-4). */ forceResolve?: boolean },
): Promise<ProjectInfo> {
  const cached = opts?.forceResolve ? undefined : cache.get(path)
  if (cached) return cached

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
  const canonicalPath = exists ? await realpath(path).catch(() => path) : path

  let info: ProjectInfo = { path: canonicalPath, repoRoot: null, isWorktree: false, branch: null, exists }

  if (exists) {
    // One spawn instead of two: git prints both answers, one per line, for a single call.
    const both = await git(canonicalPath, ['rev-parse', '--git-common-dir', '--show-toplevel'])
    const [commonDir, topLevel] = both ? both.split('\n') : [undefined, undefined]
    if (commonDir && topLevel) {
      // --git-common-dir is relative to cwd for a plain repo, absolute for a worktree.
      const absCommon = isAbsolute(commonDir) ? commonDir : resolve(canonicalPath, commonDir)
      const repoRoot = dirname(absCommon)
      const isWorktree = absCommon !== join(topLevel, '.git')
      // `symbolic-ref` (unlike `rev-parse --abbrev-ref HEAD`) also succeeds on an unborn branch
      // (a freshly `git init`ed repo with no commits yet), and fails on a detached HEAD exactly
      // as the old call did — both map to `branch: null` below, same as before.
      const branch = await git(canonicalPath, ['symbolic-ref', '-q', '--short', 'HEAD'])
      info = {
        path: canonicalPath,
        repoRoot: isWorktree ? repoRoot : topLevel,
        isWorktree,
        branch,
        exists,
      }
    }
  }

  cache.set(path, info)
  return info
}
