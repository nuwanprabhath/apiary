import type { PtySessionInfo } from '@shared/api'
import { log } from './log/logger'

/**
 * Carrying a rename made in Apiary into Claude itself.
 *
 * Apiary's own rename is stored in its database, and `~/.claude/projects` is read-only to it by
 * design. So a session renamed here kept its old name everywhere Claude's own record is read — the
 * VS Code extension's session list, `/resume` — and a fork kept its parent's name there, because
 * `--fork-session` copies the parent's `custom-title`. The one sanctioned way to change Claude's
 * record is to ask the running Claude to do it: type `/rename <title>` into its terminal.
 *
 * Typing into someone's terminal is only acceptable when it cannot disturb anything, so this waits
 * until Claude reports itself idle *and* its input box is empty. Mid-turn, or with a half-written
 * message or an open prompt in the composer, it waits; if that moment never comes it gives up and
 * leaves the rename in Apiary alone, which is where it already was.
 */

/**
 * Whether Claude's input box is empty on this rendered screen.
 *
 * The composer is the `❯` line framed by two horizontal rules at the bottom of the screen. Anything
 * after the `❯` is text the user has typed; an option cursor (`❯ 1. Yes`) means a prompt is open.
 * Either way it is not ours to type into. No composer at all (a shell, a screen mid-repaint) is
 * treated the same: not empty.
 */
export function composerIsEmpty(screen: string): boolean {
  const lines = screen.split('\n')
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const m = /^❯(.*)$/.exec(lines[i])
    if (m === null) continue
    const above = lines[i - 1].trim()
    // Only the composer sits directly under a full-width rule; a `❯` in the conversation does not.
    if (!/^─{10,}/.test(above)) return false
    return m[1].trim() === ''
  }
  return false
}

/** One line, no control characters, bounded — a title is typed as keystrokes, so a newline in it
 *  would submit early and an escape would be interpreted by the terminal. */
export function sanitizeTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

export interface RenameDeps {
  /** The session each live pty is on, as `ClaudeSessionTracker` last read it. */
  sessions: () => Record<string, PtySessionInfo>
  screen: (ptyId: string) => string
  write: (ptyId: string, data: string) => void
  isAlive: (ptyId: string) => boolean
  sleep?: (ms: number) => Promise<void>
}

export type RenameOutcome = 'renamed' | 'not-running' | 'never-idle' | 'already-named'

interface Timing { timeoutMs: number; pollMs: number; sleep: (ms: number) => Promise<void> }

function timing(deps: RenameDeps, timeoutMs: number, pollMs: number): Timing {
  return { timeoutMs, pollMs, sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))) }
}

/**
 * Types `/rename <clean>` into one pty once it is idle with an empty composer, as long as it stays
 * on `sessionId`. Resolves whether it was sent.
 */
async function sendRename(deps: RenameDeps, ptyId: string, sessionId: string, clean: string, t: Timing): Promise<RenameOutcome> {
  const current = deps.sessions()[ptyId]
  if (current?.name === clean && current.nameIsUser) return 'already-named'
  let sent = false
  for (let waited = 0; waited <= t.timeoutMs; waited += t.pollMs) {
    if (!deps.isAlive(ptyId)) break
    const info = deps.sessions()[ptyId]
    // Re-checked every time: the process may have moved to another session meanwhile.
    if (info?.sessionId !== sessionId) break
    if (info.status === 'idle' && composerIsEmpty(deps.screen(ptyId))) {
      deps.write(ptyId, `/rename ${clean}`)
      await t.sleep(300)
      deps.write(ptyId, '\r')
      sent = true
      break
    }
    await t.sleep(t.pollMs)
  }
  // Logged either way: "I renamed it in Apiary but VS Code still shows the old name" is
  // answered by whether this ran, and why not.
  log.info('rename', sent ? 'sent to claude' : 'not sent to claude', { ptyId, sessionId })
  return sent ? 'renamed' : 'never-idle'
}

/**
 * Sends `/rename <title>` to every live Claude on `sessionId`, once each is idle with an empty
 * composer. Resolves when done, or after `timeoutMs` for any that never became safe to type into.
 */
export async function renameInClaude(
  deps: RenameDeps,
  sessionId: string,
  title: string,
  timeoutMs = 60_000,
  pollMs = 500,
): Promise<RenameOutcome> {
  const clean = sanitizeTitle(title)
  if (clean === '') return 'not-running'
  const targets = Object.entries(deps.sessions()).filter(([, s]) => s.sessionId === sessionId).map(([id]) => id)
  if (targets.length === 0) return 'not-running'
  const t = timing(deps, timeoutMs, pollMs)
  let outcome: RenameOutcome = 'renamed'
  for (const ptyId of targets) {
    const one = await sendRename(deps, ptyId, sessionId, clean, t)
    if (one === 'never-idle') outcome = 'never-idle'
    else if (one === 'already-named' && outcome === 'renamed') outcome = 'already-named'
  }
  return outcome
}

/**
 * The same, for one terminal named by its pty rather than by a session id — a tab that has no
 * session id of its own yet, because Claude has written no transcript for it. Whichever session
 * the process is on when this is called is the one renamed.
 */
export async function renameTerminalInClaude(
  deps: RenameDeps,
  ptyId: string,
  title: string,
  timeoutMs = 60_000,
  pollMs = 500,
): Promise<RenameOutcome> {
  const clean = sanitizeTitle(title)
  const sessionId = deps.sessions()[ptyId]?.sessionId
  if (clean === '' || sessionId === undefined || !deps.isAlive(ptyId)) {
    log.info('rename', 'not sent to claude', { ptyId, reason: clean === '' ? 'empty title' : 'no claude session known for this terminal' })
    return 'not-running'
  }
  return sendRename(deps, ptyId, sessionId, clean, timing(deps, timeoutMs, pollMs))
}
