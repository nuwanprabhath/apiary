import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { errorMessage } from '@shared/errors'
import { isRecord } from '@shared/guards'
import { lookbackStart } from '@shared/digestLookback'
import type { DigestLookback } from '@shared/domain/residents'
import { extractThemeJson } from '@shared/theme/prompt'
import type { AccountService } from '../accounts/accountService'
import type { OneShotRequest } from '../claude/claudeOneShot'
import { realPathInside } from '../fs/confine'
import { log } from '../log/logger'
import { MAX_LINE_LENGTH, yieldToLoop } from '../search/indexer'
import type { KnowledgeStore } from './knowledgeStore'
import type { DigestJob, DigestProgress, SessionTopic } from './types'

/** About how much transcript text one model call reads. */
const WINDOW_CHARS = 40_000
/** A failed session is not tried again sooner than this. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000
const PAUSE_RECHECK_MS = 60_000
/** One message's share of a window, so a pasted log does not crowd out the conversation around it. */
const MAX_MESSAGE_CHARS = 4_000
const MAX_TOPICS_PER_WINDOW = 8
const MAX_TITLE = 120
const MAX_SUMMARY = 600
const MAX_LIST = 12
const MAX_ITEM = 80

export interface DigestableSession {
  sessionId: string
  file: string
  cwd: string | null
  /** Epoch ms; the queue is newest first. */
  lastActive: number
}

export interface DigesterDeps {
  store: KnowledgeStore
  sessions: () => DigestableSession[]
  /** A `ClaudeOneShot` of the digester's own: one call at a time. */
  runner: { run(req: OneShotRequest): Promise<string> }
  accounts: Pick<AccountService, 'launchEnv' | 'defaultId'>
  /** `userData/residents`: the residents' own sessions live under it and are never digested. */
  residentsDir: string
  now?: () => number
  /** Waits between pause re-checks; tests make it instant. */
  wait?: (ms: number) => Promise<void>
}

const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          refs: { type: 'array', items: { type: 'string' } },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
        },
        required: ['title', 'summary', 'keywords', 'refs', 'startLine', 'endLine'],
      },
    },
  },
  required: ['topics'],
}

interface Window {
  text: string
  firstLine: number
  lastLine: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** One transcript line as `<n>: User: …` / `<n>: Claude: …` with tool names only, or null when it says nothing. */
export function renderLine(lineNumber: number, line: string, maxMessage = MAX_MESSAGE_CHARS): string | null {
  if (line.length > MAX_LINE_LENGTH || line.trim() === '') return null
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    // A session file is appended to while read; a truncated last line is normal, not corruption.
    return null
  }
  if (!isRecord(entry) || (entry.type !== 'user' && entry.type !== 'assistant') || !isRecord(entry.message)) return null
  const content = entry.message.content
  const parts: string[] = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      else if (block.type === 'tool_use' && typeof block.name === 'string') parts.push(`[tool: ${block.name}]`)
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (text === '') return null
  return `${String(lineNumber)}: ${entry.type === 'user' ? 'User' : 'Claude'}: ${text.slice(0, maxMessage)}`
}

/** The transcript after `afterLine`, cut into windows, and how many lines the file has. */
async function readWindows(
  file: string, afterLine: number, windowChars = WINDOW_CHARS,
): Promise<{ windows: Window[]; totalLines: number }> {
  const windows: Window[] = []
  let current: string[] = []
  let length = 0
  let first = 0
  let last = 0
  const flush = (): void => {
    if (current.length > 0) windows.push({ text: current.join('\n'), firstLine: first, lastLine: last })
    current = []
    length = 0
  }
  let lineNumber = 0
  const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      lineNumber += 1
      if (lineNumber <= afterLine) continue
      const rendered = renderLine(lineNumber, line)
      if (rendered === null) continue
      if (current.length === 0) first = lineNumber
      current.push(rendered)
      last = lineNumber
      length += rendered.length + 1
      if (length >= windowChars) flush()
    }
  } finally {
    reader.close()
  }
  flush()
  return { windows, totalLines: lineNumber }
}

const clampLine = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

const strings = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, MAX_ITEM)).filter((s) => s !== '').slice(0, cap)
    : []

/** The model's answer as topics inside the window: no title drops the topic, lines are clamped, lengths capped. */
function validateTopics(raw: unknown, window: Pick<Window, 'firstLine' | 'lastLine'>): Omit<SessionTopic, 'id'>[] {
  if (!isRecord(raw) || !Array.isArray(raw.topics)) return []
  const out: Omit<SessionTopic, 'id'>[] = []
  for (const t of raw.topics) {
    if (!isRecord(t) || typeof t.title !== 'string' || t.title.trim() === '') continue
    let startLine = clampLine(t.startLine, window.firstLine, window.lastLine, window.firstLine)
    let endLine = clampLine(t.endLine, window.firstLine, window.lastLine, window.lastLine)
    if (endLine < startLine) [startLine, endLine] = [endLine, startLine]
    out.push({
      title: t.title.trim().slice(0, MAX_TITLE),
      summary: typeof t.summary === 'string' ? t.summary.trim().slice(0, MAX_SUMMARY) : '',
      keywords: strings(t.keywords, MAX_LIST),
      refs: strings(t.refs, MAX_LIST),
      startLine,
      endLine,
    })
    if (out.length >= MAX_TOPICS_PER_WINDOW) break
  }
  return out
}

function digestPrompt(window: Window): string {
  return [
    'Below is part of a conversation between a developer and Claude Code. Each line starts with its line number.',
    `List 1 to ${String(MAX_TOPICS_PER_WINDOW)} distinct topics discussed in lines ${String(window.firstLine)}-${String(window.lastLine)}.`,
    'For each topic give: a title of at most 8 words; a summary of at most 60 words; keywords;',
    'refs (ticket keys, merge requests, services, files); and startLine and endLine, the line numbers it spans.',
    'Answer with JSON only.',
    '',
    window.text,
  ].join('\n')
}

/**
 * Writes topic digests for every session, newest first, one model call at a time.
 *
 * Incremental twice over: a session whose file size is the one last digested is skipped without
 * being opened, and one that grew is read only after `last_line`. Progress is recorded after each
 * window, so a pause or a crash costs at most the window in flight.
 */
export class Digester implements DigestJob {
  private readonly now: () => number
  private readonly wait: (ms: number) => Promise<void>
  private readonly listeners = new Set<(activity: string | null) => void>()
  private loop: Promise<void> | null = null
  private stopRequested = false
  private model = 'haiku'
  private shouldPause: () => boolean = () => false
  /** Read when a pass builds its queue, so a change applies from the next pass. */
  private lookback: DigestLookback | null = null
  private done = 0
  private total = 0

  constructor(private readonly deps: DigesterDeps) {
    this.now = deps.now ?? Date.now
    this.wait = deps.wait ?? sleep
  }

  /** Starts a pass, or lets the one running carry on; a finished pass is started again by the next call. */
  resume(options: { model: string; lookback: DigestLookback | null; shouldPause: () => boolean }): void {
    this.model = options.model
    this.lookback = options.lookback
    this.shouldPause = options.shouldPause
    this.stopRequested = false
    if (this.loop !== null) return
    const run = this.pass().finally(() => {
      if (this.loop === run) this.loop = null
      this.emit(null)
    })
    this.loop = run
  }

  /** Stops after the call in flight. */
  pause(): void {
    this.stopRequested = true
  }

  /** Resolves when the running pass has ended; for tests and `reset`. */
  idle(): Promise<void> {
    return this.loop ?? Promise.resolve()
  }

  async reset(): Promise<void> {
    this.pause()
    await this.idle()
    this.deps.store.clear()
    this.done = 0
    this.total = 0
  }

  progress(): DigestProgress {
    return { done: this.done, total: this.total }
  }

  indexSize(): { sessions: number; topics: number } {
    return { sessions: this.deps.store.digestedCount(), topics: this.deps.store.topicCount() }
  }

  onActivity(listener: (activity: string | null) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(activity: string | null): void {
    for (const listener of this.listeners) listener(activity)
  }

  private async pass(): Promise<void> {
    try {
      const queue: DigestableSession[] = []
      const since = lookbackStart(this.lookback, this.now())
      for (const s of [...this.deps.sessions()].sort((a, b) => b.lastActive - a.lastActive)) {
        if (since !== null && s.lastActive < since) break
        if (!(await this.isResident(s))) queue.push(s)
      }
      this.done = 0
      this.total = queue.length
      for (const session of queue) {
        if (this.stopRequested) return
        await this.digestSession(session)
        this.done += 1
      }
    } catch (e) {
      log.warn('knowledge', 'digest pass failed', { error: errorMessage(e) })
    }
  }

  private async isResident(session: DigestableSession): Promise<boolean> {
    return session.cwd !== null && (await realPathInside(this.deps.residentsDir, session.cwd)) !== null
  }

  /** Whether the queue may go on; false when paused for good, true after waiting out a usage pause. */
  private async mayProceed(): Promise<boolean> {
    while (!this.stopRequested && this.shouldPause()) await this.wait(PAUSE_RECHECK_MS)
    return !this.stopRequested
  }

  private async digestSession(session: DigestableSession): Promise<void> {
    const { store } = this.deps
    let size: number
    try {
      size = (await stat(session.file)).size
    } catch {
      return
    }
    const state = store.state(session.sessionId)
    if (state !== null && state.failedAt !== null && this.now() - state.failedAt < RETRY_AFTER_MS) return
    if (state !== null && state.failedAt === null && state.size === size) return

    this.emit(`Digesting ${String(this.done + 1)}/${String(this.total)}`)
    try {
      const { windows, totalLines } = await readWindows(session.file, state?.lastLine ?? 0)
      for (const window of windows) {
        if (!(await this.mayProceed())) return
        const topics = await this.digestWindow(window)
        // The size is recorded only when the file is done, so an interrupted session is read again from its last window.
        store.record(session.sessionId, topics, { lastLine: window.lastLine, size: 0, model: this.model, at: this.now() })
        await yieldToLoop()
      }
      store.record(session.sessionId, [], { lastLine: totalLines, size, model: this.model, at: this.now() })
    } catch (e) {
      log.warn('knowledge', 'could not digest a session', { sessionId: session.sessionId, error: errorMessage(e) })
      store.markFailed(session.sessionId, this.model, this.now())
    }
  }

  private async digestWindow(window: Window): Promise<Omit<SessionTopic, 'id'>[]> {
    const stdout = await this.deps.runner.run({
      prompt: digestPrompt(window),
      model: this.model,
      jsonSchema: TOPIC_SCHEMA,
      // The default account's, like a theme or a pet: the digest is the user's own quota.
      env: this.deps.accounts.launchEnv(this.deps.accounts.defaultId()),
      timeoutMs: 180_000,
      maxStdout: 256 * 1024,
      what: 'a digest',
      tag: 'digest',
    })
    const raw = extractThemeJson(stdout)
    if (raw === null) throw new Error('The digest model did not answer with topics.')
    return validateTopics(raw, window)
  }
}
