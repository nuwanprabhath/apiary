/**
 * Git exports GIT_DIR (and GIT_INDEX_FILE, GIT_WORK_TREE…) to the commands it runs: hooks in a
 * linked worktree, `git bisect run`, `git rebase --exec`. A test that inherits them runs every
 * `git init`/`git config` of its throwaway repos against the outer repo instead. In 1.60 a
 * `git bisect run` of the e2e suite wrote `core.bare=true` and `user.name=Test` into Apiary's own
 * .git/config, and 27 commits went out authored by "Test". Every test config imports this first.
 */
const OUTER_REPO_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
] as const

export function dropOuterGitEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of OUTER_REPO_VARS) Reflect.deleteProperty(env, name)
}

dropOuterGitEnv()
