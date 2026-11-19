import type { ChatState } from './domain/chat'

export type ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'

/** Output within this long is still "in progress" rather than "gone quiet". */
export const RUNNING_WINDOW_MS = 2000

/**
 * How much of the screen the patterns below look at. Claude Code's state lives at the bottom (the
 * composer, the spinner line, a prompt box); above it is conversation, which could match a pattern.
 */
const TAIL_LINES = 15

function tail(screen: string): string {
  return screen.split('\n').filter((l) => l.trim() !== '').slice(-TAIL_LINES).join('\n')
}

/**
 * A prompt that is unambiguously waiting for the user, as Claude Code draws it. Every alternative
 * was read off a recorded session (`tests/fixtures/activity/`):
 *
 * - `Do you want to proceed?` — the permission box's question line.
 * - `Enter to confirm · Esc to cancel` — the footer under any selection list, including the
 *   folder-trust prompt at startup, whose options are words rather than numbers.
 * - `❯ 1.` — the option cursor on a numbered choice, counted only with the menu's own footer
 *   (`OPTION_CURSOR`, `MENU_FOOTER`).
 *
 * These are contiguous strings only because the classifier is handed a *rendered screen*. In the
 * raw pty stream they are not: Claude positions each word with its own cursor-move escape, so
 * `Do you want to proceed?` never appears as those bytes in that order anywhere.
 */
const PROMPT_PATTERN = /Do you want to proceed\?|Enter to confirm/

/**
 * Claude Code shows each message you sent with `❯ ` before it, so a message that starts a numbered
 * list reads `❯ 1. …`, the same as a choice's cursor. On a terminal no pane has resized (80×24) it
 * sits in the lines read here, and the tab showed a question that was not there. Every choice
 * Claude draws ends with `Esc to cancel` (the permission box, a question's picker; recorded in
 * `tests/fixtures/activity/`), and a sent message never does.
 */
const OPTION_CURSOR = /❯\s*\d+\./
const MENU_FOOTER = /Esc to cancel/

/**
 * Claude actively working: the spinner line carries a live elapsed timer in parentheses
 * (`· Forging… (2s · thinking)`), and some builds add an interrupt hint. The finished form is
 * `✻ Cogitated for 15s · done 10:39 AM` — no parentheses — so this cannot mistake a completed
 * turn for a running one.
 */
const WORKING_PATTERN = /\(\d+s\b[^)]*\)|esc to interrupt/i

/**
 * A human-readable name for a status: the status dot's `aria-label` (its colour and motion alone
 * reach neither a screen reader nor colour-blind users) and `ActivityLegend`'s row titles.
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
 * pty stream: a TUI repaints in place, so the bytes it sent are not the text a person sees.
 *
 * The order matters. A prompt outranks everything, because a prompt box repaints its own footer
 * while it waits and would keep reading as "running". Then Claude's spinner. Only then bare
 * recency, which covers a tab running something that is not Claude (a build, a plain shell).
 */
export function classifyActivity(
  screen: string,
  lastOutputAtMs: number,
  now: number,
  ptyAlive: boolean,
): ActivityStatus {
  return explainActivity(screen, lastOutputAtMs, now, ptyAlive).status
}

/** Which rule of `classifyActivity` decided a status. */
export type ActivityRule = 'gone' | 'prompt' | 'spinner' | 'output' | 'quiet'

/**
 * `classifyActivity` with the rule that decided it, for the diagnostic log. `line` is where the
 * matching text sits, counted from the bottom of the screen's non-blank lines (1 is the last),
 * so a log can tell Claude's own footer from conversation without carrying any of its text.
 */
export function explainActivity(
  screen: string,
  lastOutputAtMs: number,
  now: number,
  ptyAlive: boolean,
): { status: ActivityStatus; rule: ActivityRule; line: number | null } {
  if (!ptyAlive) return { status: 'stopped', rule: 'gone', line: null }
  const lines = tail(screen).split('\n')
  const fromBottom = (pattern: RegExp): number | null => {
    for (let at = lines.length - 1; at >= 0; at -= 1) if (pattern.test(lines[at] ?? '')) return lines.length - at
    return null
  }
  const text = lines.join('\n')
  const prompt = PROMPT_PATTERN.test(text) || (OPTION_CURSOR.test(text) && MENU_FOOTER.test(text))
  if (prompt) return { status: 'waiting', rule: 'prompt', line: fromBottom(PROMPT_PATTERN) ?? fromBottom(OPTION_CURSOR) }
  if (WORKING_PATTERN.test(text)) return { status: 'running', rule: 'spinner', line: fromBottom(WORKING_PATTERN) }
  if (now - lastOutputAtMs <= RUNNING_WINDOW_MS) return { status: 'running', rule: 'output', line: null }
  return { status: 'idle', rule: 'quiet', line: null }
}

/**
 * The one status that speaks for several (a session open in several windows, the tabs of a pane):
 * running if any is, then waiting (it needs you), then whichever came first; null for none.
 */
export function strongestActivity(statuses: readonly ActivityStatus[]): ActivityStatus | null {
  return statuses.find((s) => s === 'running') ?? statuses.find((s) => s === 'waiting') ?? statuses[0] ?? null
}

/** A background task runs with nothing on the screen, so an idle claude with tasks going is working. */
export function withBackgroundTasks(status: ActivityStatus, running: number): ActivityStatus {
  return status === 'idle' && running > 0 ? 'running' : status
}

export function chatActivity(chat: ChatState | null): ActivityStatus {
  if (chat === null || chat.status === 'exited') return 'stopped'
  if (chat.permissions.length > 0) return 'waiting'
  if (chat.status === 'busy') return 'running'
  return withBackgroundTasks('idle', chat.backgroundTasks?.length ?? 0)
}
