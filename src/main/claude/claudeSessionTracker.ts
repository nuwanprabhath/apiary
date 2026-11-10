import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PtySessionInfo } from '@shared/api'
import { log } from '../log/logger'

/**
 * Which Claude session each running terminal is on *now*, read from Claude's own bookkeeping.
 *
 * Claude Code keeps `<configRoot>/sessions/<pid>.json` for every interactive process: its current
 * `sessionId`, its `name` and whether the user chose it, and whether it is busy. Measured on real
 * sessions (Claude 2.1.281): the file exists from the moment the process starts — before the
 * session's JSONL, which is only written on the first message — `/clear` and `/resume` change its
 * `sessionId` in place, `/rename` changes its `name`, and it is removed when the process exits.
 *
 * Matching an unseen JSONL in the same folder is wrong whenever the process switches to a session
 * that already existed (`/resume` inside a new session), so this file is the source of truth.
 *
 * A missing or unreadable file is "unknown": older Claude versions do not write one, and the
 * renderer keeps its folder-matching fallback for that case.
 */
export function readClaudeSession(sessionsDir: string, pid: number): PtySessionInfo | null {
  let raw: string
  try { raw = readFileSync(sessionFile(sessionsDir, pid), 'utf8') } catch { return null }
  const info = parseSession(raw, pid)
  return typeof info === 'string' ? null : info
}

/**
 * The same read without blocking the main thread. `'missing'` is `ENOENT` only (or a file that
 * names another process); `'unreadable'` is a half-written file or any other read error, which the
 * tracker rides out rather than reporting "no session".
 */
export async function readClaudeSessionState(sessionsDir: string, pid: number): Promise<PtySessionInfo | 'missing' | 'unreadable'> {
  let raw: string
  try {
    raw = await readFile(sessionFile(sessionsDir, pid), 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'
  }
  return parseSession(raw, pid)
}

function sessionFile(sessionsDir: string, pid: number): string {
  return join(sessionsDir, `${String(pid)}.json`)
}

function parseSession(raw: string, pid: number): PtySessionInfo | 'missing' | 'unreadable' {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return 'unreadable' }
  if (typeof data !== 'object' || data === null) return 'missing'
  const d = data as Record<string, unknown>
  // A file left behind by an earlier process that had the same pid would name the wrong session.
  if (typeof d.pid === 'number' && d.pid !== pid) return 'missing'
  if (typeof d.sessionId !== 'string' || d.sessionId === '') return 'missing'
  return {
    sessionId: d.sessionId,
    name: typeof d.name === 'string' && d.name !== '' ? d.name : null,
    // Only a name the user gave (`/rename`, `--name`) is a title. A derived one ("reri-37") is a
    // label Claude made up, and would replace a perfectly good title with a worse one.
    nameIsUser: d.nameSource === 'user',
    status: statusOf(d.status),
  }
}

/**
 * Claude 2.1.319 writes four statuses, and its own session list reads `busy` and `shell` (running a
 * command) both as working, `waiting` (a permission prompt) as blocked. Blocked is neither: as idle it
 * would let a rename type into the prompt, so it is unknown here.
 */
function statusOf(status: unknown): PtySessionInfo['status'] {
  if (status === 'busy' || status === 'shell') return 'busy'
  return status === 'idle' ? 'idle' : null
}

/** A stable string for change detection — key order is fixed by construction above. */
function signature(map: Record<string, PtySessionInfo>): string {
  return JSON.stringify(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, v.sessionId, v.name, v.nameIsUser, v.status]))
}

const UNREADABLE_LIMIT = 5

export interface TrackerOptions {
  /** pty id → pid and the `sessions` folder of the account it runs under, for every live TUI pty. */
  processes: () => Map<string, { pid: number; sessionsDir: string }>
  /** Called when any pty's session, name or status changes: the chat view's working line for a
   *  session that runs in its terminal reads the status (`useTerminalBusy`). */
  onChange: (sessions: Record<string, PtySessionInfo>) => void
  intervalMs?: number
}

export class ClaudeSessionTracker {
  private latest: Record<string, PtySessionInfo> = {}
  private lastSignature = ''
  private timer: NodeJS.Timeout | null = null
  private running = false
  /** Consecutive unreadable polls per pty. Invalidated by a readable or missing poll, or the pty going. */
  private unreadable = new Map<string, number>()

  constructor(private readonly opts: TrackerOptions) {}

  start(): void {
    if (this.timer !== null) return
    void this.poll()
    this.timer = setInterval(() => { void this.poll() }, this.opts.intervalMs ?? 1000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  current(): Record<string, PtySessionInfo> {
    return this.latest
  }

  async poll(): Promise<void> {
    if (this.running) return
    this.running = true
    try { await this.pollOnce() } finally { this.running = false }
  }

  private async pollOnce(): Promise<void> {
    const next: Record<string, PtySessionInfo> = {}
    const procs = [...this.opts.processes()]
    const reads = await Promise.all(procs.map(([, { pid, sessionsDir }]) => readClaudeSessionState(sessionsDir, pid)))
    const stillUnreadable = new Map<string, number>()
    procs.forEach(([ptyId], i) => {
      const info = reads[i]
      if (info === 'unreadable') {
        const n = (this.unreadable.get(ptyId) ?? 0) + 1
        if (n >= UNREADABLE_LIMIT) {
          if (n === UNREADABLE_LIMIT) log.warn('session-tracker', 'session file unreadable, treating as missing', { ptyId, polls: n })
        } else {
          const prior = this.latest[ptyId]
          if (prior !== undefined) next[ptyId] = prior
        }
        stillUnreadable.set(ptyId, n)
      } else if (info !== 'missing' && info !== undefined) next[ptyId] = info
    })
    this.unreadable = stillUnreadable
    // Logged per transition: which pty moved to which session, and when.
    for (const [ptyId, info] of Object.entries(next)) {
      const before = this.latest[ptyId]
      if (before?.sessionId !== info.sessionId) {
        log.info('session-tracker', 'pty on session', { ptyId, from: before?.sessionId ?? null, to: info.sessionId })
      }
      if (before !== undefined && before.name !== info.name && info.nameIsUser) {
        log.info('session-tracker', 'renamed in claude', { ptyId, sessionId: info.sessionId })
      }
    }
    this.latest = next
    const sig = signature(next)
    if (sig !== this.lastSignature) {
      this.lastSignature = sig
      this.opts.onChange(next)
    }
  }
}
