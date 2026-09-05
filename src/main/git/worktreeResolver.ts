import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProjectInfo } from '@shared/types'

const run = promisify(execFile)
const cache = new Map<string, ProjectInfo>()

export function clearResolverCache(): void {
  cache.clear()
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 5000 })
    return stdout.trim()
  } catch {
    return null
  }
}

export async function resolveProject(path: string): Promise<ProjectInfo> {
  const cached = cache.get(path)
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
    const commonDir = await git(canonicalPath, ['rev-parse', '--git-common-dir'])
    const topLevel = await git(canonicalPath, ['rev-parse', '--show-toplevel'])
    if (commonDir && topLevel) {
      // --git-common-dir is relative to cwd for a plain repo, absolute for a worktree.
      const absCommon = isAbsolute(commonDir) ? commonDir : resolve(canonicalPath, commonDir)
      const repoRoot = dirname(absCommon)
      const isWorktree = absCommon !== join(topLevel, '.git')
      const branch = await git(canonicalPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      info = {
        path: canonicalPath,
        repoRoot: isWorktree ? repoRoot : topLevel,
        isWorktree,
        branch: branch === 'HEAD' ? null : branch,
        exists,
      }
    }
  }

  cache.set(path, info)
  return info
}
