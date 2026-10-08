#!/usr/bin/env node
// PostToolUse (Edit/Write/MultiEdit): lint the one file the agent just changed and hand any error
// straight back to it, so a broken `apiary/*` rule, size budget or stylelint token rule is fixed
// while the file is open — not discovered at commit or push time. Exit 2 = feedback to Claude.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const file = input?.tool_input?.file_path
if (typeof file !== 'string' || !existsSync(file)) process.exit(0)

// The checkout (main or a worktree) that owns the file: the nearest folder with eslint.config.js.
let root = dirname(file)
while (!existsSync(join(root, 'eslint.config.js'))) {
  const up = dirname(root)
  if (up === root) process.exit(0)
  root = up
}
const rel = relative(root, file)
if (rel.startsWith('..') || /(^|\/)(node_modules|out|dist|release|\.claude\/worktrees)\//.test(rel)) process.exit(0)

let cmd
if (/\.(ts|tsx|js|mjs|cjs)$/.test(rel)) cmd = ['eslint', '--max-warnings', '0', '--no-warn-ignored', rel]
else if (/\.css$/.test(rel)) cmd = ['stylelint', '--max-warnings', '0', rel]
else process.exit(0)

const r = spawnSync('npx', ['--no', '--', ...cmd], { cwd: root, encoding: 'utf8' })
if (r.status === 0) process.exit(0)
process.stderr.write(`Lint failed for ${rel} — fix it now (each apiary/* message says what to use instead):\n${r.stdout}${r.stderr}`)
process.exit(2)
