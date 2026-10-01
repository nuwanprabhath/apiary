import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one git-repo builder shared by the integration tests, the e2e harness and specs (TEST-19),
 * replacing a hand-copied `git()`/`makeRepo()`/`commit()` in each of them. Node-only: do not import
 * it from component tests (they run in a browser).
 *
 * Commits always pass `commit.gpgsign=false` per call, so a fixture never depends on the
 * developer's own git config (TEST-9). The e2e harness additionally isolates the *app's* git
 * through `GIT_CONFIG_GLOBAL`.
 */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}

/** Sets the committer identity in a repo (a clone has none of its own). */
export function setIdentity(repo: string, email = 'test@example.com', name = 'Test'): void {
  git(repo, 'config', 'user.email', email)
  git(repo, 'config', 'user.name', name)
}

/** Writes `file` with `content` (default: the message), stages everything and commits. */
export function commitFile(repo: string, file: string, message: string, content: string = message): void {
  writeFileSync(join(repo, file), content)
  git(repo, 'add', '.')
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', message)
}

/** `git init -b main` in `dir` (created if missing), an identity, and one commit of README.md. */
export function initRepo(dir: string, opts: { readme?: string } = {}): string {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  setIdentity(dir)
  commitFile(dir, 'README.md', 'init', opts.readme ?? 'init')
  return dir
}

/** Clones `remote` into the existing (empty) directory `into`, with an identity set. */
export function cloneInto(remote: string, into: string, identity?: { email: string; name: string }): void {
  git(into, 'clone', '-q', remote, '.')
  setIdentity(into, identity?.email, identity?.name)
}

export function addWorktree(repo: string, dir: string, branch: string): string {
  git(repo, 'worktree', 'add', '-q', '-b', branch, dir)
  return dir
}

/** A repo `<base>/repo-c` plus a worktree `<base>/repo-c-wt` on `feature/wt`: real nesting. */
export function makeRepoWithWorktree(base: string): { repoRoot: string; worktreeDir: string } {
  const repoRoot = initRepo(join(base, 'repo-c'), { readme: 'hi' })
  const worktreeDir = addWorktree(repoRoot, join(base, 'repo-c-wt'), 'feature/wt')
  return { repoRoot, worktreeDir }
}

/** A bare repo at `remote` (`init --bare -b main`), registered as `repo`'s `origin`. */
export function addBareRemote(repo: string, remote: string): string {
  git(repo, 'init', '-q', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  return remote
}
