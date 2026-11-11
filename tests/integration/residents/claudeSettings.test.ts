import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import { pathFirstSettings } from '../../../src/main/residents/claudeSettings'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-pathfirst-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function hookCommand(settings: unknown): string {
  const hooks = isRecord(settings) && isRecord(settings.hooks) && Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : []
  const first: unknown = hooks[0]
  const inner: unknown = isRecord(first) && Array.isArray(first.hooks) ? first.hooks[0] : null
  if (!isRecord(inner) || inner.type !== 'command' || typeof inner.command !== 'string') throw new Error('no SessionStart command hook')
  return inner.command
}

describe('pathFirstSettings', () => {
  it('its SessionStart hook writes an export that, sourced, puts the folder first on PATH, even with spaces and quotes', () => {
    const folder = "/Users/a b/Application Support/it's $HOME/bin"
    const envFile = join(dir, 'env.sh')
    execFileSync('/bin/sh', ['-c', hookCommand(pathFirstSettings(folder))], { env: { CLAUDE_ENV_FILE: envFile, PATH: '/usr/bin:/bin' } })
    expect(readFileSync(envFile, 'utf8').split('\n').filter((l) => l !== '')).toHaveLength(1)
    const path = execFileSync('/bin/sh', ['-c', `. '${envFile}'; printf %s "$PATH"`], { env: { PATH: '/usr/bin:/bin' } }).toString()
    expect(path).toBe(`${folder}:/usr/bin:/bin`)
  })
})
