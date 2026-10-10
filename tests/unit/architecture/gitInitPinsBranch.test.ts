import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Prevents: a test repository whose branch is git's default. That default differs between machines
 * (a recent local git says `main`; CI's said `master`), so a test that built a bare upstream with a
 * plain `git init` passed every local run and failed nightly on both CI platforms: the teammate's
 * clone committed to a different branch and the pull under test found nothing (1.35.1).
 *
 * Every `git init` a test runs names its branch: `-b <branch>` or `--initial-branch=<branch>`.
 */
const ROOT = join(__dirname, '../../..')
const DIRS = ['tests', 'scripts']
const INIT = /['"]init['"]\s*,[^)\]\n]*/g

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out); continue }
    if (/\.(ts|tsx|mjs|js)$/.test(name) && full !== __filename) out.push(full)
  }
}

describe('a test repository names its branch', () => {
  it('passes -b or --initial-branch to every git init', () => {
    const files: string[] = []
    for (const d of DIRS) walk(join(ROOT, d), files)
    const bare: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!/\bgit\b|execFileSync|spawnSync/.test(line)) return
        for (const m of line.matchAll(INIT)) {
          if (!/(['"]-b['"]|--initial-branch)/.test(m[0])) bare.push(`${relative(ROOT, f)}:${String(i + 1)}: ${line.trim()}`)
        }
      })
    }
    expect(bare, 'name the branch: git init -b main (git\'s default branch differs between machines)').toEqual([])
  })
})
