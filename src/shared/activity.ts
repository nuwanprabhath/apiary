export type ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'

/** Output within this long is still "in progress" rather than "gone quiet". */
const RUNNING_WINDOW_MS = 2000

/**
 * How much of the screen the patterns below look at.
 *
 * Claude Code's state lives in the furniture at the bottom — the composer, the spinner line, a
 * prompt box — while the space above it is conversation. Scanning the whole grid would put every
 * pattern at the mercy of whatever Claude happened to print, which is exactly how the first
 * version came to read its own prose as a question.
 */
const TAIL_LINES = 15

function tail(screen: string): string {
  return screen.split('\n').filter((l) => l.trim() !== '').slice(-TAIL_LINES).join('\n')
}

/**
 * A prompt that is unambiguously waiting for the user, as Claude Code actually draws it.
 *
 * Every alternative here was read off a recorded session (see `tests/fixtures/activity/`), not
 * imagined:
 *
 * - `Do you want to proceed?` — the permission box's question line.
 * - `Enter to confirm · Esc to cancel` — the footer under any selection list, including the
 *   folder-trust prompt at startup, whose options are words rather than numbers.
 * - `❯ 1.` — the option cursor on a numbered choice.
 *
 * These are contiguous strings only because the classifier is handed a *rendered screen*. In the
 * raw pty stream they are not: Claude positions each word with its own cursor-move escape, so
 * `Do you want to proceed?` never appears as those bytes in that order anywhere. A pattern matched
 * against the stream could not have fired, and did not.
 */
const PROMPT_PATTERN = /Do you want to proceed\?|Enter to confirm|❯\s*\d+\./

/**
 * Claude actively working: the spinner line carries a live elapsed timer in parentheses
 * (`· Forging… (2s · thinking)`), and some builds add an interrupt hint. The finished form is
 * `✻ Cogitated for 15s · done 10:39 AM` — no parentheses — so this cannot mistake a completed
 * turn for a running one.
 */
const WORKING_PATTERN = /\(\d+s\b[^)]*\)|esc to interrupt/i

/**
 * A human-readable name for a status, for the Active section's status dot.
 *
 * The dot otherwise carries its meaning in colour and motion alone — invisible to a screen reader
 * and indistinguishable to anyone who cannot tell the hues apart. This is what an `aria-label` on
 * the dot reads instead, and what `ActivityLegend` titles each row with.
 */
export function describeActivityStatus(status: ActivityStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'waiting': return 'Waiting for input'
    case 'idle': return 'Idle'
    case 'stopped': return 'Stopped'
  }
}

/**
 * What a session is doing right now, from the text on its terminal screen.
 *
 * `screen` is a *rendered* grid — `ScreenBuffers.read()` in `src/main/pty/screen.ts` — not the raw
 * pty stream. That distinction is the whole reason this function is trustworthy now and was not
 * before: a TUI repaints in place, so the bytes it sent and the text a person can see are
 * different things, and two shipped bugs came from confusing them.
 *
 * The order is deliberate. A prompt outranks everything, because a prompt box repaints its own
 * footer while it waits and would otherwise keep reading as "running". Claude's own spinner comes
 * next. Only then does bare recency apply, which is what covers a tab running something that is
 * not Claude at all — a build, a test run, a plain shell.
 */
export function classifyActivity(
  screen: string,
  lastOutputAtMs: number,
  now: number,
  ptyAlive: boolean,
): ActivityStatus {
  if (!ptyAlive) return 'stopped'
  const visible = tail(screen)
  if (PROMPT_PATTERN.test(visible)) return 'waiting'
  if (WORKING_PATTERN.test(visible)) return 'running'
  if (now - lastOutputAtMs <= RUNNING_WINDOW_MS) return 'running'
  return 'idle'
}
