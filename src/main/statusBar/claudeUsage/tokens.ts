import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { costForTokens, hasPricing } from './pricing'

export interface TokenBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

export interface DayUsage extends TokenBreakdown {
  /** Local date, YYYY-MM-DD. */
  date: string
  /** USD; only models with a known price. */
  costUsd: number
}

export interface MonthUsage extends TokenBreakdown {
  /** Local month, YYYY-MM. */
  month: string
  costUsd: number
}

export interface TokenStats {
  /** The last 7 local days, oldest first, every day present. */
  days: DayUsage[]
  /** The last 6 local months, oldest first, every month present. */
  months: MonthUsage[]
  /** Over the 7 days. */
  totals: TokenBreakdown
  totalCostUsd: number
  /** Some usage came from a model with no known price, so cost is understated. */
  hasUnpricedModel: boolean
  byModel: Record<string, TokenBreakdown & { requests: number; costUsd?: number }>
  computedAt: number
}

interface UsageEntry {
  dedupeKey: string
  epochMs: number
  model: string
  tokens: TokenBreakdown
}

const DAYS = 7
const MONTHS = 6

/**
 * Token usage per message from Claude Code's transcripts (`<config>/projects/<slug>/*.jsonl`) —
 * the claude-usage-stats extension's aggregator. Files are cached by size and mtime, so a refresh
 * only re-reads what changed; messages are de-duplicated by message id + request id, because a
 * resumed or forked session copies earlier messages into its own file.
 *
 * It runs on the main process, so it yields between files: the first pass over a large library
 * reads a lot, and a burst of it must not stall input routing (the search-index lesson in
 * src/main/search/CLAUDE.md). Only lines containing `"usage"` are parsed.
 */
export class TokenAggregator {
  /** Invalidated by the file's mtime and size: an entry is reused only while both still match. */
  private readonly fileCache = new Map<string, { mtimeMs: number; size: number; entries: UsageEntry[] }>()

  constructor(private readonly projectsDir: string, private readonly now: () => Date = () => new Date()) {}

  async compute(): Promise<TokenStats> {
    const today = this.now()
    const dayStart = startOfLocalDay(today)
    dayStart.setDate(dayStart.getDate() - (DAYS - 1))
    const monthStart = new Date(today.getFullYear(), today.getMonth() - (MONTHS - 1), 1)

    const live = new Set<string>()
    for (const file of await listJsonlFiles(this.projectsDir)) {
      let info
      try { info = await stat(file) } catch { continue }
      // Untouched since before the window: it cannot hold a line inside it.
      if (info.mtimeMs < monthStart.getTime()) continue
      live.add(file)
      const cached = this.fileCache.get(file)
      if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) continue
      this.fileCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, entries: await parseFile(file, monthStart.getTime()) })
      await new Promise((r) => { setImmediate(r) })
    }
    for (const key of this.fileCache.keys()) if (!live.has(key)) this.fileCache.delete(key)
    return this.aggregate(dayStart.getTime(), monthStart.getTime())
  }

  private aggregate(dayStartMs: number, monthStartMs: number): TokenStats {
    const seen = new Set<string>()
    const dayMap = new Map<string, DayUsage>()
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(dayStartMs)
      d.setDate(d.getDate() + i)
      dayMap.set(localDateKey(d), { date: localDateKey(d), ...zero(), costUsd: 0 })
    }
    const monthMap = new Map<string, MonthUsage>()
    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(monthStartMs)
      d.setMonth(d.getMonth() + i)
      monthMap.set(localMonthKey(d), { month: localMonthKey(d), ...zero(), costUsd: 0 })
    }
    const totals = zero()
    let totalCostUsd = 0
    let hasUnpricedModel = false
    const byModel: TokenStats['byModel'] = {}

    for (const { entries } of this.fileCache.values()) {
      for (const e of entries) {
        if (e.epochMs < monthStartMs || seen.has(e.dedupeKey)) continue
        seen.add(e.dedupeKey)
        const cost = costForTokens(e.model, e.tokens)
        if (cost === undefined) hasUnpricedModel = true
        const month = monthMap.get(localMonthKey(new Date(e.epochMs)))
        if (month !== undefined) { addTo(month, e.tokens); month.costUsd += cost ?? 0 }
        if (e.epochMs < dayStartMs) continue
        const day = dayMap.get(localDateKey(new Date(e.epochMs)))
        if (day !== undefined) { addTo(day, e.tokens); day.costUsd += cost ?? 0 }
        addTo(totals, e.tokens)
        totalCostUsd += cost ?? 0
        const m = (byModel[e.model] ??= { ...zero(), requests: 0, ...(hasPricing(e.model) ? { costUsd: 0 } : {}) })
        addTo(m, e.tokens)
        m.requests++
        if (m.costUsd !== undefined) m.costUsd += cost ?? 0
      }
    }
    return {
      days: [...dayMap.values()],
      months: [...monthMap.values()],
      totals, totalCostUsd, hasUnpricedModel, byModel,
      computedAt: this.now().getTime(),
    }
  }
}

const zero = (): TokenBreakdown => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })

function addTo(target: TokenBreakdown, t: TokenBreakdown): void {
  target.input += t.input
  target.output += t.output
  target.cacheRead += t.cacheRead
  target.cacheCreate += t.cacheCreate
}

export function sumTokens(t: TokenBreakdown): number {
  return t.input + t.output + t.cacheRead + t.cacheCreate
}

async function listJsonlFiles(projectsDir: string): Promise<string[]> {
  const out: string[] = []
  let dirs
  try { dirs = await readdir(projectsDir, { withFileTypes: true }) } catch { return out }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const files = await ignoreErrorsAsync(() => readdir(join(projectsDir, dir.name)), 'an unreadable project folder is skipped')
    for (const f of files ?? []) {
      if (f.endsWith('.jsonl')) out.push(join(projectsDir, dir.name, f))
    }
  }
  return out
}

/** A line longer than this is a pasted file or an image, not a usage record — skipped unparsed. */
const MAX_LINE = 1_000_000

async function parseFile(file: string, windowStartMs: number): Promise<UsageEntry[]> {
  const entries: UsageEntry[] = []
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.length > MAX_LINE || !line.includes('"usage"')) continue
      let obj: Record<string, unknown>
      try { obj = JSON.parse(line) as Record<string, unknown> } catch { continue }
      const message = (obj.message ?? {}) as Record<string, unknown>
      const usage = message.usage as Record<string, unknown> | undefined
      if (usage === undefined || typeof obj.timestamp !== 'string') continue
      const epochMs = Date.parse(obj.timestamp)
      if (!Number.isFinite(epochMs) || epochMs < windowStartMs) continue
      const dedupeKey = typeof message.id === 'string'
        ? `${message.id}:${typeof obj.requestId === 'string' ? obj.requestId : ''}`
        : `uuid:${typeof obj.uuid === 'string' ? obj.uuid : `${file}:${String(entries.length)}`}`
      entries.push({
        dedupeKey,
        epochMs,
        model: typeof message.model === 'string' ? message.model : 'unknown',
        tokens: {
          input: num(usage.input_tokens),
          output: num(usage.output_tokens),
          cacheRead: num(usage.cache_read_input_tokens),
          cacheCreate: num(usage.cache_creation_input_tokens),
        },
      })
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return entries
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function startOfLocalDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function localDateKey(d: Date): string {
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function localMonthKey(d: Date): string {
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
