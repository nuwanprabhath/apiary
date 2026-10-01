import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { SessionMeta } from '@shared/types'
import { asSessionId } from '@shared/domain/ids'
import { readHeadLines, readTailLines } from './boundaryRead'

interface Entry { type?: string; [key: string]: unknown }

function parseLines(lines: string[]): Entry[] {
  const out: Entry[] = []
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as unknown
      if (value && typeof value === 'object') out.push(value as Entry)
    } catch {
      // Corrupt or truncated line — skip it.
    }
  }
  return out
}

function toMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Extracts a plain-text prompt, ignoring system-injected content. */
function promptText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('\n')
    return text.length > 0 ? text : null
  }
  return null
}

function firstUserPrompt(entries: Entry[]): string | null {
  for (const e of entries) {
    if (e.type !== 'user' || e.isSidechain === true) continue
    const text = promptText(e.message)
    // Session-start hooks and command wrappers arrive as XML-ish blobs; skip them.
    if (text && !text.trimStart().startsWith('<')) return text.trim()
  }
  return null
}

function latestCustomTitle(entries: Entry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]
    if (e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle.trim() !== '') {
      return e.customTitle.trim()
    }
  }
  return null
}

export async function extractMeta(filePath: string): Promise<SessionMeta> {
  const info = await stat(filePath)
  const head = parseLines(await readHeadLines(filePath))
  const tail = parseLines(await readTailLines(filePath))

  const withCwd = head.find((e) => typeof e.cwd === 'string')
  const firstTimestamped = head.find((e) => typeof e.timestamp === 'string')
  const lastTimestamped = [...tail].reverse().find((e) => typeof e.timestamp === 'string')
  const lastTitle = [...tail].reverse().find(
    (e) => e.type === 'ai-title' && typeof e.aiTitle === 'string',
  )
  // The name the user gave the session in Claude — `/rename`, `--name`, or the VS Code
  // extension's rename — which Claude records as `custom-title` and re-appends each turn, so the
  // tail normally has the latest. It outranks Claude's own generated `ai-title`: a name somebody
  // chose beats one a model guessed. (A rename made in Apiary still outranks both — see
  // SessionStore's `custom_title`.) Until this was read, renaming a session in Claude changed its
  // name everywhere except Apiary.
  const customTitle = latestCustomTitle(tail) ?? latestCustomTitle(head)

  return {
    sessionId: asSessionId(basename(filePath, '.jsonl')),
    filePath,
    fileMtimeMs: info.mtimeMs,
    fileSize: info.size,
    cwd: (withCwd?.cwd as string) ?? null,
    gitBranch: (withCwd?.gitBranch as string) ?? null,
    title: customTitle ?? (lastTitle?.aiTitle as string) ?? null,
    firstPrompt: firstUserPrompt(head),
    startedAtMs: toMs(firstTimestamped?.timestamp),
    lastActiveAtMs: toMs(lastTimestamped?.timestamp) ?? info.mtimeMs,
    // An exact count needs a full pass; filled in when the transcript is read.
    messageCount: null,
  }
}

export interface ScanStats {
  /** How many `.jsonl` files were found under `projectsRoot`. */
  filesSeen: number
  /** How many of those were actually opened and re-parsed (MAIN-1: the rest were skipped by
   *  `isUnchanged`). */
  filesParsed: number
}

export interface ScanOptions {
  /**
   * Lets a caller skip re-reading a file whose size and mtime match what it already has on
   * record — the store already keeps both per session (MAIN-1). Omit it (the default) to always
   * parse every file, which is what every existing caller and test expects.
   */
  isUnchanged?(path: string, size: number, mtimeMs: number): boolean
  /** Filled in with per-pass counts once scanning finishes, for the "measure before fixing" log line. */
  stats?: ScanStats
}

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
  for (const dir of dirs) {
    const dirPath = join(projectsRoot, dir)
    let files: string[]
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      filesSeen += 1
      const filePath = join(dirPath, f)
      try {
        if (opts?.isUnchanged) {
          const info = await stat(filePath)
          if (opts.isUnchanged(filePath, info.size, info.mtimeMs)) continue
        }
        filesParsed += 1
        results.push(await extractMeta(filePath))
      } catch {
        // Unreadable file — skip rather than fail the whole scan.
      }
    }
  }
  if (opts?.stats) {
    opts.stats.filesSeen = filesSeen
    opts.stats.filesParsed = filesParsed
  }
  return results
}
