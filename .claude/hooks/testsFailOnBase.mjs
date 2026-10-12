// "A test that fails without the change and passes with it" (CLAUDE.md, Definition of done), checked
// rather than claimed. In the 1.39.0 run, four of five agents wrote their tests after the code and
// never saw them fail; each said so in its report, and the lead had to check every branch by hand
// (checking out the old src/ in the agent's worktree, which once re-staged a file the branch had
// deleted). A test written after the code can pass on the old code too and prove nothing.
//
// So: the branch's changed unit, integration and component tests run against the branch BASE's
// src/, in a throwaway worktree (the agent's own tree is never touched). At least one must fail.
// A test file that does not even compile against the old code (it imports what the change added)
// counts as failing: without the change, it cannot pass.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Returns a problem string, or null when the branch's tests are shown to fail on the base (or the
 * check does not apply: no src/ change, no changed test, or a `No-Red-Test-Reason:` trailer).
 */
export function testsFailOnBase({ root, base, changed, git }) {
  if (!base) return null
  const src = changed.filter((f) => /^src\//.test(f) && !/(^|\/)CLAUDE\.md$/.test(f))
  const nodeTests = changed.filter((f) => /^tests\/(unit|integration)\/.*\.test\.ts$/.test(f) && !/^tests\/unit\/architecture\//.test(f))
  const componentTests = changed.filter((f) => /^tests\/component\/(?!ui\/).*\.test\.tsx?$/.test(f))
  if (src.length === 0 || nodeTests.length + componentTests.length === 0) return null
  if (git(['log', '--format=%(trailers:key=No-Red-Test-Reason,valueonly)', `${base}..HEAD`]).trim() !== '') return null

  const dir = mkdtempSync(join(tmpdir(), 'apiary-red-on-base-'))
  const tree = join(dir, 'tree')
  try {
    const add = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', tree, base], { cwd: root, encoding: 'utf8' })
    if (add.status !== 0) return null // cannot build the comparison here; the other checks still ran
    // The base's code, with this branch's tests (and their fixtures and helpers).
    rmSync(join(tree, 'tests'), { recursive: true, force: true })
    cpSync(join(root, 'tests'), join(tree, 'tests'), { recursive: true })
    symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'))
    const vitest = (args) => spawnSync('npx', ['--no', '--', 'vitest', 'run', ...args], { cwd: tree, encoding: 'utf8' }).status
    const red = (nodeTests.length > 0 && vitest(nodeTests) !== 0)
      || (componentTests.length > 0 && vitest(['--config', 'vitest.component.config.ts', ...componentTests]) !== 0)
    if (red) return null
    return `── tests pass without the change ──\nThis branch changes ${String(src.length)} file(s) under src/, but every test it added or changed (${[...nodeTests, ...componentTests].slice(0, 4).join(', ')}${nodeTests.length + componentTests.length > 4 ? ', …' : ''}) also passes on the branch base's src/ (${base.slice(0, 8)}). So none of them proves the change.\nWrite a test that states the new behaviour, run it against the old code and see it fail, then make it pass. If the change truly has no observable behaviour (a pure refactor), say why in a commit trailer: \`No-Red-Test-Reason: <why>\`.`
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: root })
    rmSync(dir, { recursive: true, force: true })
    spawnSync('git', ['worktree', 'prune'], { cwd: root })
  }
}
