import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyActivity, type ActivityStatus } from '../../src/shared/activity'
import { renderScreen } from '../../src/main/pty/screen'

/**
 * `classifyActivity` against recorded output from real Claude Code sessions.
 *
 * The status dot shipped wrong twice, and both times the cause was the same: a pattern written
 * against an imagined terminal. Hand-written fixtures could not catch it, because the same
 * imagination wrote the fixture and the pattern — they agreed with each other and with nothing
 * else. These files are bytes captured from an actual Haiku session driven through a pty by
 * `scripts/capture-activity-fixtures.mjs`, so a passing test here means the classifier works on
 * what Claude Code really prints.
 *
 * Each case names a scenario and the status a person looking at that screen would expect. Add a
 * case by recording it, not by writing it.
 */
const DIR = join(__dirname, '..', 'fixtures', 'activity')

interface Meta { sinceLastOutputMs: number; note: string }

function load(name: string): { raw: string; meta: Meta } {
  return {
    raw: readFileSync(join(DIR, `${name}.txt`), 'utf8'),
    meta: JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Meta,
  }
}

/**
 * The scenarios, with what each should classify as. `sinceLastOutputMs` comes from the capture
 * rather than being chosen here — how long ago the terminal last printed is half of what the
 * classifier is given, and inventing it would throw away the part of the recording that matters
 * most for telling `running` from `idle`.
 */
const CASES: { name: string; expected: ActivityStatus }[] = [
  { name: 'trust-prompt', expected: 'waiting' },
  { name: 'startup-idle', expected: 'idle' },
  { name: 'idle-after-answer', expected: 'idle' },
  { name: 'working', expected: 'running' },
  { name: 'idle-after-question-prose', expected: 'idle' },
  { name: 'permission-prompt', expected: 'waiting' },
  { name: 'question-prompt', expected: 'waiting' },
]

describe('classifyActivity against recorded Claude Code sessions', () => {
  for (const { name, expected } of CASES) {
    const present = existsSync(join(DIR, `${name}.txt`))
    // A missing recording fails rather than skipping: a scenario nobody can reproduce is a gap in
    // the evidence, and a silently skipped case is how this suite would rot back into guesswork.
    it(`classifies "${name}" as ${expected}`, async () => {
      expect(present, `missing fixture ${name}.txt — re-run scripts/capture-activity-fixtures.mjs`)
        .toBe(true)
      const { raw, meta } = load(name)
      const screen = await renderScreen(raw)
      const now = 1_000_000
      expect(classifyActivity(screen, now - meta.sinceLastOutputMs, now, true)).toBe(expected)
    })
  }

  it('reports stopped for any recording once the pty has exited', async () => {
    const screen = await renderScreen(load('working').raw)
    expect(classifyActivity(screen, 1_000_000, 1_000_000, false)).toBe('stopped')
  })

  it('does not read a question mark left on screen as a question being asked', async () => {
    // The regression the user hit twice. The echoed prompt "what is a pty?" is still on screen
    // while the session sits doing nothing — the exact shape that used to paint the dot amber.
    // Asserted here rather than left implicit in the table above, so that if the recording is ever
    // replaced by one without a question mark in it, this fails instead of quietly proving nothing.
    const screen = await renderScreen(load('idle-after-answer').raw)
    expect(screen).toMatch(/\?\s*$/m)
    expect(classifyActivity(screen, 0, 1_000_000, true)).toBe('idle')
  })
})

describe('classifyActivity on output that is not Claude Code', () => {
  it('is running while a plain command is still printing, and idle once it stops', async () => {
    // The fallback that covers a shell tab: no Claude furniture on screen at all, so recency is
    // the only signal there is.
    const screen = await renderScreen('$ npm run build\r\nwebpack compiled\r\n')
    const now = 1_000_000
    expect(classifyActivity(screen, now - 500, now, true)).toBe('running')
    expect(classifyActivity(screen, now - 30_000, now, true)).toBe('idle')
  })
})
