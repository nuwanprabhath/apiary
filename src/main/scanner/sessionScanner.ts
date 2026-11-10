import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { SessionMeta } from '@shared/types'
import { asSessionId } from '@shared/domain/ids'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { decodeEntry, type ClaudeEntry, type MessageContent } from '../transcript/claudeEntry'
import { readHeadLines, readTailLines } from './boundaryRead'

/** Lines that are not JSON objects (a corrupt or truncated line) are skipped. */
function parseLines(lines: string[]): ClaudeEntry[] {
  const out: ClaudeEntry[] = []
  for (const line of lines) {
    const entry = decodeEntry(line)
    if (entry !== null) out.push(entry)
  }
  return out
}

function toMs(value: string | undefined): number | null {
  if (value === undefined) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Extracts a plain-text prompt, ignoring system-injected content. */
function promptText(content: MessageContent): string | null {
  if (typeof content === 'string') return content
  if (content === undefined) return null
  const text = content.flatMap((b) => (b.type === 'text' && b.text !== undefined ? [b.text] : [])).join('\n')
  return text.length > 0 ? text : null
}

function firstUserPrompt(entries: ClaudeEntry[]): string | null {
  for (const e of entries) {
    if (e.type !== 'user' || e.isSidechain || !e.message) continue
    const text = promptText(e.message.content)
    // Session-start hooks and command wrappers arrive as XML-ish blobs; skip them.
    if (text && !text.trimStart().startsWith('<')) return text.trim()
  }
  return null
}

function latestCustomTitle(entries: ClaudeEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]
    if (e.type === 'custom-title' && e.customTitle !== undefined && e.customTitle.trim() !== '') {
      return e.customTitle.trim()
    }
  }
  return null
}

function aiTitle(entries: ClaudeEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]
    if (e.type === 'ai-title' && e.aiTitle !== undefined) return e.aiTitle
  }
  return undefined
}

export async function extractMeta(filePath: string): Promise<SessionMeta> {
  const info = await stat(filePath)
  const head = parseLines(await readHeadLines(filePath))
  const tail = parseLines(await readTailLines(filePath))

  // A first line over the head's 64 KB (a pasted image) is dropped from the head; every later line
  // carries the same cwd, so the tail names it. The first prompt is not recoverable from the tail.
  const withCwd = head.find((e) => e.cwd !== undefined) ?? tail.find((e) => e.cwd !== undefined)
  const firstTimestamped = head.find((e) => e.timestamp !== undefined)
    ?? tail.find((e) => e.timestamp !== undefined)
  const lastTimestamped = [...tail].reverse().find((e) => e.timestamp !== undefined)
  // The name the user gave the session in Claude — `/rename`, `--name`, or the VS Code
  // extension's rename — which Claude records as `custom-title` and re-appends each turn, so the
  // tail normally has the latest. It outranks Claude's own generated `ai-title`: a name somebody
  // chose beats one a model guessed. (A rename made in Apiary still outranks both — see
  // SessionStore's `custom_title`.)
  const customTitle = latestCustomTitle(tail) ?? latestCustomTitle(head)

  return {
    sessionId: asSessionId(basename(filePath, '.jsonl')),
    filePath,
    fileMtimeMs: info.mtimeMs,
    fileSize: info.size,
    cwd: withCwd?.cwd ?? null,
    gitBranch: withCwd?.gitBranch ?? null,
    title: customTitle ?? aiTitle(tail) ?? null,
    firstPrompt: firstUserPrompt(head),
    startedAtMs: toMs(firstTimestamped?.timestamp),
    lastActiveAtMs: toMs(lastTimestamped?.timestamp) ?? info.mtimeMs,
    // An exact count needs a full pass; filled in when the transcript is read.
    messageCount: null,
  }
}

interface ScanStats {
  /** How many `.jsonl` files were found under `projectsRoot`. */
  filesSeen: number
  /** How many of those were actually opened and re-parsed (the rest were skipped by `isUnchanged`). */
  filesParsed: number
}

export interface ScanOptions {
  /**
   * Lets a caller skip re-reading a file whose size and mtime match what it already has on
   * record — the store already keeps both per session. Omit it (the default) to always
   * parse every file, which is what every existing caller and test expects.
   */
  isUnchanged?(path: string, size: number, mtimeMs: number): boolean
  /** Filled in with per-pass counts once scanning finishes, for the "measure before fixing" log line. */
  stats?: ScanStats
}

const SCAN_CONCURRENCY = 16

export async function scanProjects(projectsRoot: string, opts?: ScanOptions): Promise<SessionMeta[]> {
  let dirs: string[]
  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true })
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }

  const results: SessionMeta[] = []
  let filesSeen = 0
  let filesParsed = 0
  for (const dir of dirs.sort()) {
    const dirPath = join(projectsRoot, dir)
    let files: string[]
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith('.jsonl')).sort()
    } catch {
      continue
    }
    filesSeen += files.length
    const metas: (SessionMeta | null)[] = new Array<SessionMeta | null>(files.length).fill(null)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const i = next
        next += 1
        const filePath = join(dirPath, files[i])
        metas[i] = (await ignoreErrorsAsync(async () => {
          if (opts?.isUnchanged) {
            const info = await stat(filePath)
            if (opts.isUnchanged(filePath, info.size, info.mtimeMs)) return null
          }
          filesParsed += 1
          return await extractMeta(filePath)
        }, 'an unreadable file is skipped rather than failing the whole scan')) ?? null
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, worker))
    for (const m of metas) if (m) results.push(m)
  }
  if (opts?.stats) {
    opts.stats.filesSeen = filesSeen
    opts.stats.filesParsed = filesParsed
  }
  return results
}
