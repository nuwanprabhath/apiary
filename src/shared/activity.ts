import type { ChatState } from './domain/chat'

export type ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'

/** Output within this long is still "in progress" rather than "gone quiet". */
const RUNNING_WINDOW_MS = 2000

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
 * - `❯ 1.` — the option cursor on a numbered choice.
 *
 * These are contiguous strings only because the classifier is handed a *rendered screen*. In the
 * raw pty stream they are not: Claude positions each word with its own cursor-move escape, so
 * `Do you want to proceed?` never appears as those bytes in that order anywhere.
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
  if (!ptyAlive) return 'stopped'
  const visible = tail(screen)
  if (PROMPT_PATTERN.test(visible)) return 'waiting'
  if (WORKING_PATTERN.test(visible)) return 'running'
  if (now - lastOutputAtMs <= RUNNING_WINDOW_MS) return 'running'
  return 'idle'
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
