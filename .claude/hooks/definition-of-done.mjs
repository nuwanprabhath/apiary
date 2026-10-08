#!/usr/bin/env node
// Stop / SubagentStop: "done" means the definition of done in CLAUDE.md, checked rather than
// claimed. If the working tree has changes to code, the turn may not end until both tsconfigs
// typecheck and every changed file lints. Exit 2 = the reason is shown to Claude and it continues.
// `stop_hook_active` is set when Claude is already continuing because of this hook: let that turn
// end, so a failure Claude cannot fix turns into a report instead of a loop.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { /* no input: use the defaults */ }
if (input.stop_hook_active === true) process.exit(0)

const root = typeof input.cwd === 'string' ? input.cwd : process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
if (!existsSync(join(root, 'eslint.config.js'))) process.exit(0)

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout ?? ''
const changed = [...new Set([
  ...git(['diff', '--name-only', 'HEAD']).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
])].filter((f) => f !== '' && existsSync(join(root, f)))
const code = changed.filter((f) => /^(src|tests|eslint|scripts)\//.test(f) || /\.(ts|tsx|css)$/.test(f))
if (code.length === 0) process.exit(0)

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

if (problems.length === 0) process.exit(0)
process.stderr.write(`Not done yet — the definition of done (CLAUDE.md) fails on your uncommitted changes:\n\n${problems.join('\n')}\nFix these, then finish. Tests in the cheapest layer that proves the change are still yours to run.\n`)
process.exit(2)
