import { describe, it, expect } from 'vitest'
import { classifyActivity, describeActivityStatus } from '../../src/shared/activity'

/**
 * The classifier's contract, stated over screen text.
 *
 * `classifyActivity` is handed a *rendered* terminal screen (see `src/main/pty/screen.ts`), so
 * everything here is plain text laid out the way a person would see it. The screens below are
 * trimmed from the real recordings in `tests/fixtures/activity/` — this file states the rules,
 * `activityFixtures.test.ts` proves they hold against whole unedited sessions. Neither replaces
 * the other: this one says what the behaviour is, that one says it is true of real Claude Code.
 */

const RULE = '─'.repeat(80)

/** An idle Claude: a finished turn, then the empty composer framed by its two rules. */
const IDLE = [
  '❯ In one short sentence: what is a pty?',
  '',
  '⏺ A PTY (pseudo-terminal) is a software interface that emulates a physical terminal.',
  '',
  '✻ Cooked for 2s · done 10:43 AM',
  RULE,
  '❯ ',
  RULE,
  '  Haiku 4.5 │ ctx:19%',
  '  ⏸ manual mode on',
].join('\n')

/** Mid-turn: the spinner line carries a live elapsed timer in parentheses. */
const WORKING = [
  '❯ What are the ways third-party apps can know the status of a Claude session?',
  '',
  '· Forging… (2s · thinking)',
  RULE,
  '❯ ',
  RULE,
  '  ⏸ manual mode on',
].join('\n')

/** The permission box, as Claude draws it over the composer. */
const PERMISSION_PROMPT = [
  RULE,
  ' Bash command',
  '   rm -f ./definitely-not-here.txt',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to this project',
  '   3. No',
  ' Esc to cancel · Tab to amend',
].join('\n')

/** The folder-trust prompt at startup: a selection list whose options are words, not numbers. */
const TRUST_PROMPT = [
  ' Quick safety check: Is this a project you created or one you trust?',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n')

describe('classifyActivity', () => {
  const now = 1_000_000

  it('is stopped when the pty has exited, whatever is on the screen', () => {
    expect(classifyActivity(WORKING, now - 100, now, false)).toBe('stopped')
    expect(classifyActivity(PERMISSION_PROMPT, now - 100, now, false)).toBe('stopped')
  })

  it('is waiting at a permission prompt', () => {
    expect(classifyActivity(PERMISSION_PROMPT, now - 30_000, now, true)).toBe('waiting')
  })

  it('is waiting at a selection prompt whose options are words rather than numbers', () => {
    // The folder-trust prompt has no "Do you want to proceed?" and no numbered options — without
    // the confirm-footer alternative it would read as idle, which is the one reading that leaves
    // someone waiting on a question they were never told about.
    expect(classifyActivity(TRUST_PROMPT, now - 30_000, now, true)).toBe('waiting')
  })

  it('stays waiting while a prompt box repaints its own footer', () => {
    // A prompt is not a still image: Claude keeps redrawing its hint line and counters while it
    // waits. Recency must not outrank the prompt, or the dot alternates between blue and amber for
    // the whole time a question is on screen.
    expect(classifyActivity(PERMISSION_PROMPT, now - 100, now, true)).toBe('waiting')
  })

  it('is running while the spinner shows a live elapsed timer', () => {
    // Asserted with stale recency on purpose: the screen alone has to carry this, because a turn
    // that is thinking rather than printing can go quiet for longer than the recency window.
    expect(classifyActivity(WORKING, now - 30_000, now, true)).toBe('running')
  })

  it('is idle once the turn has finished, even though a question mark is still on screen', () => {
    // The bug that shipped twice. "what is a pty?" is sitting in the echoed prompt, and the old
    // classifier read any line ending in "?" as a question being asked of the user.
    expect(IDLE).toMatch(/\?\s*$/m)
    expect(classifyActivity(IDLE, now - 30_000, now, true)).toBe('idle')
  })

  it('does not mistake a finished turn\'s "for 5s · done" for the running spinner', () => {
    // `✻ Cooked for 2s · done` and `· Forging… (2s · thinking)` differ only by the parentheses.
    expect(classifyActivity(IDLE, now - 30_000, now, true)).toBe('idle')
    expect(classifyActivity(WORKING, now - 30_000, now, true)).toBe('running')
  })

  it('falls back to recency for a terminal that is not running Claude at all', () => {
    // A shell tab: no Claude furniture to read, so "printed something just now" is all there is.
    const shell = '$ npm run build\nwebpack compiled in 1400ms\n$ '
    expect(classifyActivity(shell, now - 500, now, true)).toBe('running')
    expect(classifyActivity(shell, now - 30_000, now, true)).toBe('idle')
  })

  it('only reads the bottom of the screen, so conversation above cannot decide the status', () => {
    // Claude quoting a prompt back, or explaining one, must not put the dot in `waiting`. Only the
    // furniture at the bottom of the screen says what the session is doing.
    const quoted = ['⏺ Claude will ask "Do you want to proceed?" before running it.']
      .concat(Array.from({ length: 20 }, () => '  more explanation'))
      .concat([RULE, '❯ ', RULE, '  ⏸ manual mode on'])
      .join('\n')
    expect(classifyActivity(quoted, now - 30_000, now, true)).toBe('idle')
  })
})

describe('describeActivityStatus', () => {
  it('gives every status a distinct, human-readable name for the dot\'s aria-label', () => {
    expect(describeActivityStatus('running')).toBe('Running')
    expect(describeActivityStatus('waiting')).toBe('Waiting for input')
    expect(describeActivityStatus('idle')).toBe('Idle')
    expect(describeActivityStatus('stopped')).toBe('Stopped')
  })
})
