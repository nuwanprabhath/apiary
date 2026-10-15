import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, walk } from './allowlist'

/**
 * Prevents: a `claude` that Apiary starts without an account's environment. A session that belongs
 * to the "work" account would then run, silently, under the main login (and write to its usage and
 * its Keychain item), and the settings that say which account a session uses would be decorative.
 *
 * Every call to a command builder (`buildResumeCommand`, `buildNewSessionCommand`,
 * `buildChatCommand`) and every `spawnLoginShell` in `main/claude`, `main/chat` and
 * `main/terminals` must sit in a function that also hands the account's environment on: an
 * `envFor(` / `launchEnv(` / `claudeEnv(` call, or an `extraEnv`. The functions are found by their
 * indentation (a class method at two spaces, a top-level function at none), so a call in a nested
 * closure counts toward the method around it.
 */
const DIRS = ['src/main/claude', 'src/main/chat', 'src/main/terminals']
const STARTS = /\b(buildResumeCommand|buildNewSessionCommand|buildChatCommand|spawnLoginShell)\(/
const ENV = /\b(envFor\(|launchEnv\(|claudeEnv\(|extraEnv)/
const HEADER = /^(?: {2}(?:(?:private|public|protected|static|async|readonly)\s+)*[A-Za-z_$][\w$]*\(|(?:export\s+)?(?:async\s+)?function\s)/

/** Each function body as `{ name, from, lines }`, split at the lines that open a method or a function. */
export function functionsOf(source: string): Array<{ header: string; from: number; text: string }> {
  const lines = source.split('\n')
  const out: Array<{ header: string; from: number; text: string }> = []
  let header = ''
  let from = 0
  let text: string[] = []
  const flush = (): void => { if (from > 0) out.push({ header, from, text: text.join('\n') }) }
  lines.forEach((line, i) => {
    if (HEADER.test(line)) {
      flush()
      header = line.trim(); from = i + 1; text = []
    }
    text.push(line)
  })
  flush()
  return out
}

/** The functions that start a `claude` and do not pass an account's environment on. */
export function startsWithoutAccount(source: string): string[] {
  return functionsOf(source)
    .filter((fn) => STARTS.test(fn.text) && !ENV.test(fn.text))
    // The builders' own definitions and their import lines are not calls.
    .filter((fn) => fn.text.split('\n').some((l) => STARTS.test(l) && !/^\s*(import|export function)/.test(l)))
    .map((fn) => `${fn.header} (line ${String(fn.from)})`)
}

describe('every claude Apiary starts runs under an account', () => {
  const files = walk(DIRS, ['.ts'], () => false)

  it('scans the files that start claude', () => {
    expect(files).toContain('src/main/terminals/terminalService.ts')
    expect(files).toContain('src/main/chat/chatManager.ts')
    expect(files).toContain('src/main/claude/claudeOneShot.ts')
  })

  it('has no start without an account environment', () => {
    const bad = files.flatMap((rel) => startsWithoutAccount(readFileSync(join(ROOT, rel), 'utf8')).map((fn) => `${rel}: ${fn}`))
    expect(bad.map((b) => `${b} starts claude without the account's env: pass \`accounts.launchEnv(account)\` as the pty \`env\` or \`extraEnv\``)).toEqual([])
  })

  it('fires on a start that leaves the environment out', () => {
    const missing = [
      'export class X {',
      '  start(): void {',
      "    spawnLoginShell({ command: buildChatCommand('x'), cwd: '/' })",
      '  }',
      '}',
    ].join('\n')
    expect(startsWithoutAccount(missing)).toEqual(['start(): void { (line 2)'])
    expect(startsWithoutAccount(missing.replace("cwd: '/'", "cwd: '/', extraEnv: {}"))).toEqual([])
  })
})
