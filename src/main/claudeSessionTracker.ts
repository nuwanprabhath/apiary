import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PtySessionInfo } from '@shared/api'
import { log } from './log/logger'

/**
 * Which Claude session each running terminal is on *now*, read from Claude's own bookkeeping.
 *
 * Claude Code keeps `<configRoot>/sessions/<pid>.json` for every interactive process: its current
 * `sessionId`, its `name` and whether the user chose it, and whether it is busy. Measured on real
 * sessions (Claude 2.1.281): the file exists from the moment the process starts — before the
 * session's JSONL, which is only written on the first message — `/clear` and `/resume` change its
 * `sessionId` in place, `/rename` changes its `name`, and it is removed when the process exits.
 *
 * Before this, a terminal was tied to a session by guesswork: a new or forked session's tab
 * waited for an unseen JSONL to appear in the same folder and assumed it was the one. That guess
 * is wrong whenever the process switches to a session that already existed — `/resume` inside a
 * new session — and the tab then stayed a `new:<uuid>` pty forever, which is why it could not be
 * pinned, never reached Recent, showed its pty id in Active, and could not be forked. Reading the
 * answer is not a guess.
 *
 * A missing or unreadable file is simply "unknown": older Claude versions do not write one, and
 * the renderer keeps its folder-matching fallback for that case.
 */
export function readClaudeSession(sessionsDir: string, pid: number): PtySessionInfo | null {
  let raw: string
  try { raw = readFileSync(join(sessionsDir, `${String(pid)}.json`), 'utf8') } catch { return null }
  let data: unknown
  try { data = JSON.parse(raw) } catch { return null }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  // A file left behind by an earlier process that had the same pid would name the wrong session.
  if (typeof d.pid === 'number' && d.pid !== pid) return null
  if (typeof d.sessionId !== 'string' || d.sessionId === '') return null
  return {
    sessionId: d.sessionId,
    name: typeof d.name === 'string' && d.name !== '' ? d.name : null,
    // Only a name the user gave (`/rename`, `--name`) is a title. A derived one ("reri-37") is a
    // label Claude made up, and would replace a perfectly good title with a worse one.
    nameIsUser: d.nameSource === 'user',
    status: d.status === 'busy' || d.status === 'idle' ? d.status : null,
  }
}

/** A stable string for change detection — key order is fixed by construction above. */
function signature(map: Record<string, PtySessionInfo>): string {
  return JSON.stringify(Object.keys(map).sort().map((k) => [k, map[k].sessionId, map[k].name, map[k].nameIsUser]))
}

export interface TrackerOptions {
  sessionsDir: string
  /** pty id → pid, for every live TUI pty. */
  pids: () => Map<string, number>
  /** Called when any pty's session or name changes — not on status alone, which flips constantly. */
  onChange: (sessions: Record<string, PtySessionInfo>) => void
  intervalMs?: number
}

export class ClaudeSessionTracker {
  private latest: Record<string, PtySessionInfo> = {}
  private lastSignature = ''
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly opts: TrackerOptions) {}

  start(): void {
    if (this.timer !== null) return
    this.poll()
    this.timer = setInterval(() => { this.poll() }, this.opts.intervalMs ?? 1000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  current(): Record<string, PtySessionInfo> {
    return this.latest
  }

  /** One pass: read every pty's file, log what moved, and report if anything did. */
  poll(): void {
    const next: Record<string, PtySessionInfo> = {}
    for (const [ptyId, pid] of this.opts.pids()) {
      const info = readClaudeSession(this.opts.sessionsDir, pid)
      if (info !== null) next[ptyId] = info
    }
    // Logged per transition because this is the one fact that would have explained the stuck
    // `new:<uuid>` tabs at a glance: which pty moved to which session, and when.
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
