import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThemeGenerator } from '../../src/main/theme/themeGenerator'
import { BUILTIN_THEMES } from '../../src/shared/theme/builtins'

/**
 * The generator against a stand-in `claude`: a script that records how it was called and prints
 * a canned reply. What matters most here is what it is *not* given — tools, customisations, a
 * directory with anything in it — and that whatever it replies only arrives validated.
 */
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-gen-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function standIn(body: string): string {
  const script = join(dir, 'claude')
  writeFileSync(script, [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > "${dir}/argv.txt"`,
    `pwd > "${dir}/cwd.txt"`,
    `ls -A > "${dir}/ls.txt"`,
    body,
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}
const reply = (theme: object): string => `cat <<'JSON'\n${JSON.stringify({ type: 'result', is_error: false, structured_output: theme })}\nJSON`
const gen = (bin: string, timeoutMs?: number): ThemeGenerator => new ThemeGenerator({ claudeBin: () => bin, timeoutMs, shell: '/bin/sh' })

describe('ThemeGenerator', () => {
  it('returns the validated theme Claude designed', async () => {
    const g = gen(standIn(reply(BUILTIN_THEMES[0].spec)))
    const { spec, report } = await g.generate({ request: 'like the Matrix movie', current: null, model: 'sonnet' })
    expect(spec.name).toBe('Matrix')
    expect(report.droppedColors + report.unknown).toBe(0)
  })

  it('gives Claude no tools, none of the user customisations, and an empty folder that is then removed', async () => {
    const g = gen(standIn(reply(BUILTIN_THEMES[0].spec)))
    await g.generate({ request: 'anything', current: null, model: 'haiku' })
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n')
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
    for (const flag of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--json-schema']) expect(argv).toContain(flag)
    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku')
    expect(readFileSync(join(dir, 'ls.txt'), 'utf8').trim()).toBe('')
    expect(existsSync(readFileSync(join(dir, 'cwd.txt'), 'utf8').trim())).toBe(false)
  })

  it('never passes the request through a shell: quotes and $() arrive as text', async () => {
    const g = gen(standIn(reply(BUILTIN_THEMES[0].spec)))
    await g.generate({ request: `"; touch ${dir}/pwned; echo "$(touch ${dir}/pwned2)`, current: null, model: 'sonnet' })
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    expect(existsSync(join(dir, 'pwned2'))).toBe(false)
  })

  it('applies only the safe parts of a hostile reply', async () => {
    const g = gen(standIn(reply({ name: 'Evil', palette: { bg: 'url(https://x/y)', accent: '#ff0000' }, effects: [{ kind: 'fireworks' }] })))
    const { spec, report } = await g.generate({ request: 'x', current: null, model: 'sonnet' })
    expect(spec.palette.bg).toBeUndefined()
    expect(spec.palette.accent).toBe('#ff0000ff')
    expect(spec.effects).toEqual([])
    expect(report.droppedColors).toBe(1)
  })

  it('says so when the reply has no theme, when Claude fails, and when it takes too long', async () => {
    await expect(gen(standIn("echo '{\"result\":\"sorry\"}'")).generate({ request: 'x', current: null, model: 'sonnet' }))
      .rejects.toThrow(/no theme/)
    await expect(gen(standIn('echo boom >&2; exit 3')).generate({ request: 'x', current: null, model: 'sonnet' }))
      .rejects.toThrow(/exit 3/)
    await expect(gen(standIn('sleep 5'), 300).generate({ request: 'x', current: null, model: 'sonnet' }))
      .rejects.toThrow(/too long/)
  })

  it('refuses an oversized reply', async () => {
    await expect(gen(standIn("head -c 100000 /dev/zero | tr '\\0' 'a'")).generate({ request: 'x', current: null, model: 'sonnet' }))
      .rejects.toThrow(/too large/)
  })

  it('can be cancelled, and runs one generation at a time', async () => {
    const g = gen(standIn('sleep 5'))
    const first = g.generate({ request: 'x', current: null, model: 'sonnet' })
    await expect(g.generate({ request: 'y', current: null, model: 'sonnet' })).rejects.toThrow(/Already/)
    await new Promise((r) => setTimeout(r, 100))
    g.cancel()
    await expect(first).rejects.toThrow(/Cancelled/)
    expect(g.busy).toBe(false)
  })

  it('sends the current theme along for a refinement', async () => {
    const g = gen(standIn(reply(BUILTIN_THEMES[1].spec)))
    await g.generate({ request: 'more green', current: BUILTIN_THEMES[0].spec, model: 'sonnet' })
    expect(readFileSync(join(dir, 'argv.txt'), 'utf8')).toContain('Adjustment requested:\nmore green')
  })
})
