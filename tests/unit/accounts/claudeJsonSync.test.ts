import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type * as Fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const calls = vi.hoisted(() => [] as string[])
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return { ...actual, renameSync: (a: string, b: string) => { calls.push(a.endsWith('.tmp') ? 'rename-tmp' : 'rename'); actual.renameSync(a, b) } }
})

import { syncClaudeJson } from '../../../src/main/accounts/claudeJsonSync'

let dir: string
let main: string
let account: string
const read = (f: string): Record<string, unknown> => JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-claudejson-'))
  main = join(dir, 'main.json')
  account = join(dir, 'account.json')
  calls.length = 0
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('syncClaudeJson', () => {
  it('copies mcpServers', () => {
    writeFileSync(main, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    syncClaudeJson(main, account)
    expect(read(account).mcpServers).toEqual({ a: { command: 'x' } })
  })

  it('copies hasTrustDialogAccepted per project without touching other project keys', () => {
    writeFileSync(main, JSON.stringify({ projects: { '/p': { hasTrustDialogAccepted: true, extra: 1 }, '/q': { other: 2 } } }))
    writeFileSync(account, JSON.stringify({ projects: { '/p': { lastCost: 5 }, '/z': { keep: true } } }))
    syncClaudeJson(main, account)
    expect(read(account).projects).toEqual({ '/p': { lastCost: 5, hasTrustDialogAccepted: true }, '/z': { keep: true } })
  })

  it('leaves every other key', () => {
    writeFileSync(main, JSON.stringify({ oauthAccount: { emailAddress: 'main@x' }, mcpServers: {} }))
    writeFileSync(account, JSON.stringify({ oauthAccount: { emailAddress: 'work@x' }, numStartups: 3 }))
    syncClaudeJson(main, account)
    expect(read(account)).toMatchObject({ oauthAccount: { emailAddress: 'work@x' }, numStartups: 3 })
  })

  it('creates the account file when missing', () => {
    writeFileSync(main, JSON.stringify({ mcpServers: { a: 1 } }))
    expect(existsSync(account)).toBe(false)
    syncClaudeJson(main, account)
    expect(existsSync(account)).toBe(true)
  })

  it('writes atomically (temp + rename)', () => {
    writeFileSync(main, JSON.stringify({ mcpServers: { a: 1 } }))
    syncClaudeJson(main, account)
    expect(calls).toEqual(['rename-tmp'])
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
