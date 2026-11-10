import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readClaudeSession, readClaudeSessionState, ClaudeSessionTracker } from '../../src/main/claude/claudeSessionTracker'
import type { PtySessionInfo } from '@shared/api'

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

  it('reads a command running (shell) as busy, and a permission prompt (waiting) as unknown, as Claude 2.1.319 writes them', () => {
    writeFileSync(join(dir, '8.json'), sessionFile(8, { status: 'shell', version: '2.1.319' }))
    expect(readClaudeSession(dir, 8)?.status).toBe('busy')
    writeFileSync(join(dir, '9.json'), sessionFile(9, { status: 'waiting', version: '2.1.319' }))
    expect(readClaudeSession(dir, 9)?.status).toBeNull()
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

describe('readClaudeSessionState', () => {
  it('tells a missing file from an unreadable one', async () => {
    expect(await readClaudeSessionState(dir, 99)).toBe('missing')
    writeFileSync(join(dir, '5.json'), '{"pid":5,"sessionId":"abc')
    expect(await readClaudeSessionState(dir, 5)).toBe('unreadable')
  })
})

describe('ClaudeSessionTracker', () => {
  it('reports when a terminal switches session (what /clear and /resume do) or starts working, and not otherwise', async () => {
    const seen: Array<Record<string, PtySessionInfo>> = []
    const tracker = new ClaudeSessionTracker({
      processes: () => new Map([['new:abc', { pid: 4242, sessionsDir: dir }], ['shell:x:1', { pid: 5555, sessionsDir: dir }]]),
      onChange: (s) => { seen.push(s) },
    })
    writeFileSync(join(dir, '4242.json'), sessionFile(4242))
    await tracker.poll()
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0])).toEqual(['new:abc'])

    // Nothing changed: nothing to report.
    await tracker.poll()
    expect(seen).toHaveLength(1)

    // Claude starting a turn is reported: a chat view of a session in its terminal shows it working.
    writeFileSync(join(dir, '4242.json'), sessionFile(4242, { status: 'busy' }))
    await tracker.poll()
    expect(seen).toHaveLength(2)
    expect(seen[1]['new:abc'].status).toBe('busy')
    // Running a command is still working, so busy to shell is no change.
    writeFileSync(join(dir, '4242.json'), sessionFile(4242, { status: 'shell' }))
    await tracker.poll()
    expect(seen).toHaveLength(2)

    writeFileSync(join(dir, '4242.json'), sessionFile(4242, { sessionId: 'd1163941-62f6-4d46-abdf-f787b95ab7e6' }))
    await tracker.poll()
    expect(seen).toHaveLength(3)
    expect(seen[2]['new:abc'].sessionId).toBe('d1163941-62f6-4d46-abdf-f787b95ab7e6')
  })

  it('reports a rename, and forgets a terminal whose process has gone', async () => {
    const seen: Array<Record<string, PtySessionInfo>> = []
    let pids = new Map([['p', { pid: 10, sessionsDir: dir }]])
    const tracker = new ClaudeSessionTracker({ processes: () => pids, onChange: (s) => { seen.push(s) } })
    writeFileSync(join(dir, '10.json'), sessionFile(10))
    await tracker.poll()
    writeFileSync(join(dir, '10.json'), sessionFile(10, { name: 'Better name', nameSource: 'user' }))
    await tracker.poll()
    expect(seen.at(-1)?.p.name).toBe('Better name')

    pids = new Map()
    await tracker.poll()
    expect(seen.at(-1)).toEqual({})
  })

  function tornSetup() {
    const seen: Array<Record<string, PtySessionInfo>> = []
    const tracker = new ClaudeSessionTracker({
      processes: () => new Map([['p', { pid: 20, sessionsDir: dir }]]),
      onChange: (s) => { seen.push(s) },
    })
    return { seen, tracker }
  }

  it('keeps the known session through a torn read and does not report it', async () => {
    const { seen, tracker } = tornSetup()
    writeFileSync(join(dir, '20.json'), sessionFile(20))
    await tracker.poll()
    writeFileSync(join(dir, '20.json'), '{"pid":20,"sessionId":"abc')
    await tracker.poll()
    expect(seen).toHaveLength(1)
    expect(tracker.current().p.sessionId).toBe('bdf6e1a5-0a4c-485e-ae6c-f3d8719c2ed0')
  })

  it('drops the session when the file is missing', async () => {
    const { seen, tracker } = tornSetup()
    writeFileSync(join(dir, '20.json'), sessionFile(20))
    await tracker.poll()
    rmSync(join(dir, '20.json'))
    await tracker.poll()
    expect(seen.at(-1)).toEqual({})
  })

  it('treats a file unreadable for 5 polls in a row as missing', async () => {
    const { seen, tracker } = tornSetup()
    writeFileSync(join(dir, '20.json'), sessionFile(20))
    await tracker.poll()
    writeFileSync(join(dir, '20.json'), '{"pid":')
    for (let i = 0; i < 4; i++) await tracker.poll()
    expect(tracker.current().p).toBeDefined()
    await tracker.poll()
    expect(tracker.current().p).toBeUndefined()
    expect(seen.at(-1)).toEqual({})
  })

  it('skips a poll while the previous one is still running', async () => {
    let calls = 0
    const tracker = new ClaudeSessionTracker({
      processes: () => { calls++; return new Map() },
      onChange: () => {},
    })
    const first = tracker.poll()
    await tracker.poll()
    await first
    expect(calls).toBe(1)
  })

  it("reads each pty's pid file from its own account's sessions folder", async () => {
    const other = mkdtempSync(join(tmpdir(), 'apiary-sessions-other-'))
    try {
      writeFileSync(join(dir, '7.json'), sessionFile(7, { sessionId: 'aaaaaaaa-0a4c-485e-ae6c-f3d8719c2ed0' }))
      writeFileSync(join(other, '8.json'), sessionFile(8, { sessionId: 'bbbbbbbb-0a4c-485e-ae6c-f3d8719c2ed0' }))
      const tracker = new ClaudeSessionTracker({
        processes: () => new Map([['main-pty', { pid: 7, sessionsDir: dir }], ['work-pty', { pid: 8, sessionsDir: other }]]),
        onChange: () => {},
      })
      await tracker.poll()
      expect(tracker.current()['main-pty'].sessionId).toBe('aaaaaaaa-0a4c-485e-ae6c-f3d8719c2ed0')
      expect(tracker.current()['work-pty'].sessionId).toBe('bbbbbbbb-0a4c-485e-ae6c-f3d8719c2ed0')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})
