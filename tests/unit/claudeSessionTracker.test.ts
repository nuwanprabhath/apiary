import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readClaudeSession, ClaudeSessionTracker } from '../../src/main/claudeSessionTracker'
import type { PtySessionInfo } from '../../src/shared/api'

/**
 * The file shape below is copied from a real Claude 2.1.281 `~/.claude/sessions/<pid>.json`,
 * recorded while driving a Haiku session through /rename and /clear — not reconstructed from docs.
 */
function sessionFile(pid: number, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid,
    sessionId: 'bdf6e1a5-0a4c-485e-ae6c-f3d8719c2ed0',
    cwd: '/tmp/haiku-lab',
    startedAt: 1790157014933,
    version: '2.1.281',
    kind: 'interactive',
    name: 'haiku-lab-b9',
    nameSource: 'derived',
    status: 'idle',
    ...over,
  })
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-sessions-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('readClaudeSession', () => {
  it('reads which session a process is on', () => {
    writeFileSync(join(dir, '4242.json'), sessionFile(4242))
    expect(readClaudeSession(dir, 4242)).toEqual({
      sessionId: 'bdf6e1a5-0a4c-485e-ae6c-f3d8719c2ed0', name: 'haiku-lab-b9', nameIsUser: false, status: 'idle',
    })
  })

  it('marks a name the user gave with /rename as a title, and a derived one as not', () => {
    writeFileSync(join(dir, '7.json'), sessionFile(7, { name: 'Renamed in the TUI', nameSource: 'user' }))
    expect(readClaudeSession(dir, 7)?.nameIsUser).toBe(true)
  })

  it('is unknown, not an error, for a process with no file — older Claude versions write none', () => {
    expect(readClaudeSession(dir, 99)).toBeNull()
  })

  it('ignores a half-written file and one left behind by an earlier process with the same pid', () => {
    writeFileSync(join(dir, '5.json'), '{"pid":5,"sessionId":"abc')
    expect(readClaudeSession(dir, 5)).toBeNull()
    writeFileSync(join(dir, '6.json'), sessionFile(1234))
    expect(readClaudeSession(dir, 6)).toBeNull()
  })
})

describe('ClaudeSessionTracker', () => {
  it('reports when a terminal switches session — what /clear and /resume do — and not otherwise', () => {
    const seen: Array<Record<string, PtySessionInfo>> = []
    const tracker = new ClaudeSessionTracker({
      sessionsDir: dir,
      pids: () => new Map([['new:abc', 4242], ['shell:x:1', 5555]]),
      onChange: (s) => { seen.push(s) },
    })
    writeFileSync(join(dir, '4242.json'), sessionFile(4242))
    tracker.poll()
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0])).toEqual(['new:abc'])

    // Status flips constantly while Claude works; that alone is not a change worth broadcasting.
    writeFileSync(join(dir, '4242.json'), sessionFile(4242, { status: 'busy' }))
    tracker.poll()
    expect(seen).toHaveLength(1)

    writeFileSync(join(dir, '4242.json'), sessionFile(4242, { sessionId: 'd1163941-62f6-4d46-abdf-f787b95ab7e6' }))
    tracker.poll()
    expect(seen).toHaveLength(2)
    expect(seen[1]['new:abc'].sessionId).toBe('d1163941-62f6-4d46-abdf-f787b95ab7e6')
  })

  it('reports a rename, and forgets a terminal whose process has gone', () => {
    const seen: Array<Record<string, PtySessionInfo>> = []
    let pids = new Map([['p', 10]])
    const tracker = new ClaudeSessionTracker({ sessionsDir: dir, pids: () => pids, onChange: (s) => { seen.push(s) } })
    writeFileSync(join(dir, '10.json'), sessionFile(10))
    tracker.poll()
    writeFileSync(join(dir, '10.json'), sessionFile(10, { name: 'Better name', nameSource: 'user' }))
    tracker.poll()
    expect(seen.at(-1)?.p.name).toBe('Better name')

    pids = new Map()
    tracker.poll()
    expect(seen.at(-1)).toEqual({})
  })
})
