import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { composerIsEmpty, sanitizeTitle, renameInClaude } from '../../src/main/claudeRename'
import { renderScreen } from '../../src/main/pty/screen'
import type { PtySessionInfo } from '../../src/shared/api'

/**
 * Typing `/rename` into a user's terminal is only acceptable when it cannot disturb anything. The
 * screens below are real recordings of Claude (tests/fixtures/activity), rendered the way the app
 * renders them — not composer lines typed out by hand.
 */
const fixture = (name: string): Promise<string> =>
  renderScreen(readFileSync(join(__dirname, '../fixtures/activity', `${name}.txt`), 'utf8'))

describe('composerIsEmpty', () => {
  it('is true for an idle Claude with nothing typed', async () => {
    expect(composerIsEmpty(await fixture('idle-after-answer'))).toBe(true)
    expect(composerIsEmpty(await fixture('startup-idle'))).toBe(true)
  })

  it('is false while a permission or question prompt is open', async () => {
    expect(composerIsEmpty(await fixture('permission-prompt'))).toBe(false)
    expect(composerIsEmpty(await fixture('question-prompt'))).toBe(false)
    expect(composerIsEmpty(await fixture('trust-prompt'))).toBe(false)
  })

  it('is false when the user has started typing a message', async () => {
    const idle = await fixture('idle-after-answer')
    // `\s`, not a space: Claude draws the composer as `❯` and a non-breaking space.
    const typing = idle.replace(/^❯\s*$/m, '❯ half a thought about the')
    expect(typing).not.toBe(idle)
    expect(composerIsEmpty(typing)).toBe(false)
  })

  it('is false for a screen with no composer at all, such as a plain shell', () => {
    expect(composerIsEmpty('$ ls\nREADME.md\n$ ')).toBe(false)
  })
})

describe('sanitizeTitle', () => {
  it('keeps it to one line, since a newline typed into Claude would submit early', () => {
    expect(sanitizeTitle('fork: #2 Datetime\nissue\u001b[31m')).toBe('fork: #2 Datetime issue [31m')
  })
})

describe('renameInClaude', () => {
  const info = (over: Partial<PtySessionInfo> = {}): PtySessionInfo =>
    ({ sessionId: 's1', name: 'reri-12', nameIsUser: false, status: 'idle', ...over })

  it('waits for Claude to go idle, then types /rename and Enter', async () => {
    const idleScreen = await fixture('idle-after-answer')
    let status: 'busy' | 'idle' = 'busy'
    const written: string[] = []
    let polls = 0
    const outcome = await renameInClaude({
      sessions: () => ({ 'new:a': info({ status }) }),
      screen: () => idleScreen,
      write: (_id, d) => { written.push(d) },
      isAlive: () => true,
      sleep: async () => { polls += 1; if (polls === 3) status = 'idle' },
    }, 's1', 'fork: Parent', 10_000, 10)
    expect(outcome).toBe('renamed')
    expect(written).toEqual(['/rename fork: Parent', '\r'])
  })

  it('never types into a prompt, and gives up rather than wait forever', async () => {
    const promptScreen = await fixture('permission-prompt')
    const written: string[] = []
    const outcome = await renameInClaude({
      sessions: () => ({ p: info() }),
      screen: () => promptScreen,
      write: (_id, d) => { written.push(d) },
      isAlive: () => true,
      sleep: async () => {},
    }, 's1', 'New name', 50, 10)
    expect(outcome).toBe('never-idle')
    expect(written).toEqual([])
  })

  it('does nothing for a session with no terminal running', async () => {
    const outcome = await renameInClaude({
      sessions: () => ({ p: info({ sessionId: 'other' }) }),
      screen: () => '', write: () => { throw new Error('must not type') }, isAlive: () => true,
    }, 's1', 'New name')
    expect(outcome).toBe('not-running')
  })
})
