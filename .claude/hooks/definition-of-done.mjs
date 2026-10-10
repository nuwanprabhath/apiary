#!/usr/bin/env node
// Stop / SubagentStop: "done" means the definition of done in CLAUDE.md, checked rather than
// claimed. If the working tree has changes to code, the turn may not end until both tsconfigs
// typecheck and every changed file lints. Exit 2 = the reason is shown to Claude and it continues.
// A turn that is blocked keeps being blocked, `stop_hook_active` or not, until MAX_BLOCKS stops in a
// row: a 1.35.0 agent stopped a second time straight past this hook (the old rule let the second
// stop through) and reported 8 failing component tests as passing. After MAX_BLOCKS it may stop, so
// a failure it cannot fix is not an endless loop, but the hook leaves `<git dir>/apiary-not-done`
// with the failures, so whoever reads the agent's report can see what the report does not say.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { /* no input: use the defaults */ }
const MAX_BLOCKS = 5

const root = typeof input.cwd === 'string' ? input.cwd : process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
if (!existsSync(join(root, 'eslint.config.js'))) process.exit(0)

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout ?? ''
const gitDir = git(['rev-parse', '--absolute-git-dir']).trim()
const blocksFile = gitDir ? join(gitDir, 'apiary-stop-blocks') : ''
const notDoneFile = gitDir ? join(gitDir, 'apiary-not-done') : ''
const passed = () => {
  for (const f of [blocksFile, notDoneFile]) if (f && existsSync(f)) rmSync(f)
  process.exit(0)
}
// Everything this branch changed, not only what is uncommitted: an agent that commits and then stops
// must still be checked (a 1.35.0 agent committed half a feature, with a red lint, and the hook saw
// a clean tree and let it finish). The base is where the branch left main.
// An agent working from a release branch is judged on its own commits: run-agent.sh sets
// APIARY_BASE_REF to that branch.
const baseRef = process.env.APIARY_BASE_REF || 'main'
const base = (git(['merge-base', 'HEAD', baseRef]) || git(['merge-base', 'HEAD', `origin/${baseRef}`])).trim()
const changed = [...new Set([
  ...(base ? git(['diff', '--name-only', base]).split('\n') : []),
  ...git(['diff', '--name-only', 'HEAD']).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
])].filter((f) => f !== '' && existsSync(join(root, f)))
const code = changed.filter((f) => /^(src|tests|eslint|scripts)\//.test(f) || /\.(ts|tsx|css)$/.test(f))
if (code.length === 0) passed()

const problems = []
const run = (label, args) => {
  const r = spawnSync('npx', ['--no', '--', ...args], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) problems.push(`── ${label} ──\n${r.stdout}${r.stderr}`)
}
run('typecheck (tsconfig.json)', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('typecheck (tsconfig.node.json)', ['tsc', '--noEmit', '-p', 'tsconfig.node.json'])
const js = code.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
if (js.length) run('eslint (changed files)', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...js])
// The architecture tests are part of the guard layer, not of "the tests": they check the source the
// way lint does (duplicate helpers, contract coverage, error boundaries) and take about a second.
run('architecture tests', ['vitest', 'run', '--project', 'unit', 'tests/unit/architecture'])
const css = code.filter((f) => f.endsWith('.css'))
if (css.length) run('stylelint (changed files)', ['stylelint', '--max-warnings', '0', ...css])
// The rest of `npm run lint` that is whole-repo by nature: layer direction and dead code. "Plumbing
// nobody uses yet" (a hook, a service, an IPC call with no caller) is what a half-built feature
// looks like, and the knip ratchet is what notices it.
run('layer rules (lint:arch)', ['depcruise', 'src', '--config', '.dependency-cruiser.cjs', '--ignore-known', '--output-type', 'err'])
{
  const r = spawnSync('node', ['scripts/knip-ratchet.mjs'], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) problems.push(`── dead code (lint:dead) ──\n${r.stdout}${r.stderr}`)
}

// A behaviour change comes with a test (CLAUDE.md, Definition of done). A 1.35.0 agent committed a
// pets change with no test at all although its brief and CLAUDE.md both asked for one; nothing
// noticed. So: a branch that changes src/ but no tests/ file is not done, unless one of its commits
// says why in a `No-Test-Reason:` trailer (a pure move, a comment, a doc) — recorded in history,
// where a reviewer sees it.
{
  const src = changed.filter((f) => /^src\//.test(f) && !/(^|\/)CLAUDE\.md$/.test(f))
  const tests = changed.filter((f) => /^tests\//.test(f))
  const reasons = base ? git(['log', '--format=%(trailers:key=No-Test-Reason,valueonly)', `${base}..HEAD`]).trim() : ''
  if (src.length > 0 && tests.length === 0 && reasons === '') {
    problems.push(`── no test ──\nThis branch changes ${String(src.length)} file(s) under src/ (${src.slice(0, 4).join(', ')}${src.length > 4 ? ', …' : ''}) and no file under tests/.\nAdd a test in the cheapest layer that proves the change (tests/CLAUDE.md). If the change truly needs none, say why in a commit trailer: \`No-Test-Reason: <why>\`.`)
  }
}

// A UI change is looked at, not only tested. 1.35.0 agents shipped a toolbar menu drawn as a
// bulleted list, find-bar buttons in the browser's grey defaults and labels cut to "H..", all with
// green tests. So a branch that changes the renderer's markup or styles must (1) bring its states
// into a UI scenario (tests/component/ui/*.ui.test.tsx, `reviewUi`), whose screenshots the lead
// reviews, and (2) pass the UI audit in every scenario. The gate itself (the audit, its baselines,
// `data-ui-allow` exceptions) does not move in an agent's branch without a reason a reviewer reads.
{
  const ui = changed.filter((f) => /^src\/renderer\/.*\.(tsx|css)$/.test(f))
  const scenarios = changed.filter((f) => /^tests\/component\/ui\/.*\.ui\.test\.tsx$/.test(f))
  const trailer = (key) => (base ? git(['log', `--format=%(trailers:key=${key},valueonly)`, `${base}..HEAD`]).trim() : '')
  if (ui.length > 0 && scenarios.length === 0 && trailer('No-UI-Review-Reason') === '') {
    problems.push(`── no UI scenario ──\nThis branch changes ${String(ui.length)} renderer file(s) (${ui.slice(0, 4).join(', ')}${ui.length > 4 ? ', …' : ''}) and no UI scenario.\nAdd or extend tests/component/ui/<feature>.ui.test.tsx: open each state you built (menus open, narrow window, long text) and call reviewUi (see .claude/skills/ui-review/SKILL.md). Run \`npm run ui:review\` and look at your screenshots. If nothing visible changed, say why in a commit trailer: \`No-UI-Review-Reason: <why>\`.`)
  }
  if (ui.length > 0 || scenarios.length > 0) {
    const r = spawnSync('npx', ['--no', '--', 'vitest', 'run', '--config', 'vitest.component.config.ts', 'tests/component/ui/'], { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) problems.push(`── UI audit (tests/component/ui) ──\n${`${r.stdout}${r.stderr}`.split('\n').filter((l) => /^\s{2}[a-z-]+: |×|AssertionError|Fixed, so delete/.test(l)).slice(0, 60).join('\n')}\nFix what it names; the screenshots are in ui-review/shots/. Never add to knownDefects.allow.json or a data-ui-allow to pass.`)
  }
  if (base) {
    const keys = (f, at) => {
      const text = at === 'now' ? (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '{}') : (spawnSync('git', ['show', `${base}:${f}`], { cwd: root, encoding: 'utf8' }).stdout || '{}')
      return (text.match(/^\s*"[^"]+":/gm) ?? []).length
    }
    for (const f of ['tests/component/ui/knownDefects.allow.json', 'tests/unit/architecture/classesDefined.allow.json']) {
      const existed = spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: root }).status === 0
      if (existed && keys(f, 'now') > keys(f, 'base')) problems.push(`── UI baseline grew ──\n${f} has more entries than at the branch base. It only shrinks: fix the defect instead.`)
    }
    const srcNow = git(['grep', '-c', 'data-ui-allow', '--', 'src']).split('\n').reduce((n, l) => n + (Number(l.split(':').pop()) || 0), 0)
    const srcThen = git(['grep', '-c', 'data-ui-allow', base, '--', 'src']).split('\n').reduce((n, l) => n + (Number(l.split(':').pop()) || 0), 0)
    if (srcNow > srcThen && trailer('UI-Allow-Reason') === '') problems.push(`── UI audit exception added ──\nThis branch adds a data-ui-allow. Fix the layout instead; if the element truly must break the rule (a session title that truncates with its full text in a tooltip), say why in a commit trailer: \`UI-Allow-Reason: <element, rule, why>\`.`)
    const gate = changed.filter((f) => /^tests\/component\/ui\/(audit|review)\.ts$/.test(f))
    if (gate.length > 0 && trailer('UI-Gate-Change') === '') problems.push(`── UI audit changed ──\n${gate.join(', ')} changed in this branch. The audit is the lead's: do not weaken or tune it to pass. If you found a false positive, describe it in your report instead (or say why in a \`UI-Gate-Change:\` trailer).`)
  }
}

// Done work is committed work (CLAUDE.md, Definition of done: "in a Conventional Commit"). A 1.35.0
// agent fixed three bugs, ran every suite, said so, and left all 21 files uncommitted: work a
// worktree reset or a stash would lose, and that no reviewer's `git log` would show.
{
  const dirty = git(['status', '--porcelain']).split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(3))
    .filter((f) => /^(src|tests|eslint|scripts|docs)\//.test(f) || /\.(ts|tsx|css|json|md)$/.test(f))
  if (dirty.length > 0) {
    problems.push(`── uncommitted ──\n${String(dirty.length)} changed file(s) are not committed (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}).\nCommit them (Conventional Commit, no AI attribution) once the checks above pass.`)
  }
}

// Tests are not deleted to get green. A 1.35.0 agent replaced a feature, then deleted three of the
// old feature's behaviour tests (including "a changed setting wins over an earlier use of the
// switch") instead of carrying them over. Counted per test file the branch touched or removed, at
// the branch base and now; fewer cases fails, unless a commit says why in `Removed-Tests-Reason:`.
if (base) {
  const CASE = /\b(?:it|test)(?:\.(?:only|skip|todo|each\([^)]*\)))?\s*\(/g
  const count = (text) => (text.match(CASE) ?? []).length
  const touched = git(['diff', '--name-only', base]).split('\n').filter((f) => /^tests\/.*\.(test|spec)\.tsx?$/.test(f))
  let before = 0
  let after = 0
  const lost = []
  for (const f of touched) {
    const was = count(spawnSync('git', ['show', `${base}:${f}`], { cwd: root, encoding: 'utf8' }).stdout ?? '')
    const now = existsSync(join(root, f)) ? count(readFileSync(join(root, f), 'utf8')) : 0
    before += was
    after += now
    if (now < was) lost.push(`${f}: ${String(was)} → ${String(now)}`)
  }
  const why = git(['log', '--format=%(trailers:key=Removed-Tests-Reason,valueonly)', `${base}..HEAD`]).trim()
  if (after < before && why === '') {
    problems.push(`── tests removed ──\nThis branch has fewer test cases than it started with (${String(before)} → ${String(after)}):\n  ${lost.join('\n  ')}\nCarry the behaviour they checked over to the new code and keep the tests. If a behaviour was removed on purpose, say so in a commit trailer: \`Removed-Tests-Reason: <which behaviour and why>\`.`)
  }
}

// The tests this branch added or changed must pass: an agent cannot finish on a red test it wrote,
// and a test written from the requirement stays binding. (A 1.35.0 agent reported "all tests
// pass" while describing a feature that did not exist; the tests it had are what the hook can hold
// it to.) The full suites are still the definition of done; this is the part that is cheap here.
{
  const nodeTests = changed.filter((f) => /^tests\/(unit|integration)\/.*\.test\.ts$/.test(f))
  if (nodeTests.length) run('changed unit/integration tests', ['vitest', 'run', ...nodeTests])
  const componentTests = changed.filter((f) => /^tests\/component\/.*\.test\.tsx?$/.test(f))
  if (componentTests.length) run('changed component tests', ['vitest', 'run', '--config', 'vitest.component.config.ts', ...componentTests])
}

if (problems.length === 0) passed()
const blocks = (blocksFile && existsSync(blocksFile) ? Number(readFileSync(blocksFile, 'utf8')) || 0 : 0) + 1
if (blocksFile) writeFileSync(blocksFile, String(blocks))
if (blocks > MAX_BLOCKS) {
  // Let the turn end, but leave the truth where the reviewer looks.
  if (notDoneFile) writeFileSync(notDoneFile, `NOT DONE — stopped after ${String(MAX_BLOCKS)} blocked attempts.\n\n${problems.join('\n')}\n`)
  process.stderr.write(`Stopping with the definition of done still failing; recorded in ${notDoneFile}. Say so in your report: these checks FAIL.\n`)
  process.exit(0)
}
process.stderr.write(`Not done yet (blocked ${String(blocks)}/${String(MAX_BLOCKS)}) — the definition of done (CLAUDE.md) fails on this branch's changes:\n\n${problems.join('\n')}\nFix these, then finish. Do not report a check as passing that this hook shows failing.\n`)
process.exit(2)
