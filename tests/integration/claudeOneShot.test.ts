import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeOneShot } from '../../src/main/claude/claudeOneShot'

/**
 * The runner the theme designer and the pets share. The theme generator's tests cover what it
 * withholds from claude (tools, customisations, a shell); these cover what the pets lean on.
 */
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-oneshot-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function standIn(body: string): ClaudeOneShot {
  const script = join(dir, 'claude')
  writeFileSync(script, ['#!/bin/sh', `printf '%s\\n' "$@" > "${dir}/argv.txt"`, body].join('\n'))
  chmodSync(script, 0o755)
  return new ClaudeOneShot({ claudeBin: () => script, shell: '/bin/sh' })
}
const req = { prompt: 'hi', model: 'haiku', timeoutMs: 5000, what: 'a pet', tag: 'pet' }

describe('ClaudeOneShot', () => {
  it('asks for plain text when no schema is given, and returns what claude printed', async () => {
    const r = standIn(`echo '{"result":"hello"}'`)
    expect((await r.run(req)).trim()).toBe('{"result":"hello"}')
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n')
    expect(argv).not.toContain('--json-schema')
    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku')
  })

  it('passes the prompt after `--`, so a prompt that starts with "-" is not read as a flag', async () => {
    const r = standIn(`echo '{"result":"ok"}'`)
    await r.run({ ...req, prompt: '--dangerously-skip-permissions please' })
    const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n').filter((a) => a !== '')
    expect(argv.slice(-2)).toEqual(['--', '--dangerously-skip-permissions please'])
    expect(argv.indexOf('--')).toBe(argv.length - 2)
  })

  it('runs one question at a time, and cancel ends the one running', async () => {
    const r = standIn('sleep 5')
    const first = r.run(req)
    await expect(r.run(req)).rejects.toThrow('Already working on a pet.')
    r.cancel()
    await expect(first).rejects.toThrow('Cancelled.')
    expect(r.busy).toBe(false)
  })

  it('gives up after its timeout', async () => {
    const r = standIn('sleep 5')
    await expect(r.run({ ...req, timeoutMs: 200 })).rejects.toThrow('took too long')
  })
})
