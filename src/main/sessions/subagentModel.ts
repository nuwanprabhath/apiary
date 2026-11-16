import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackgroundTaskModel } from '@shared/chatTimeline'
import { isRecord } from '@shared/guards'
import { realPathInside } from '../fs/confine'
import { decodeEntry } from '../transcript/claudeEntry'
import { readTail } from './backgroundTaskOutput'

/** How much of the end of a subagent's transcript is read: its latest assistant entry is in it. */
export const SUBAGENT_TAIL_BYTES = 64 * 1024
/** The least time between two reads of one subagent's file while its task runs. */
export const SUBAGENT_REFRESH_MS = 3000
/** An agent id as Claude Code writes it: letters and digits, nothing that could name another path. */
const AGENT_ID = /^[A-Za-z0-9]+$/

const NOT_KNOWN: BackgroundTaskModel = { model: null, effort: null }

const named = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** The model and effort of the last assistant entry in `tail` (JSONL, newest last); null when it has none. */
export function modelFromTail(tail: string): BackgroundTaskModel | null {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line === undefined || line === '') continue
    const entry = decodeEntry(line)
    if (entry?.type === 'assistant' && entry.model !== undefined && entry.model !== '') return { model: entry.model, effort: entry.effort ?? null }
  }
  return null
}

interface Cached { size: number; mtimeMs: number; readAt: number; value: BackgroundTaskModel }

/**
 * The model and effort a background agent runs on, from its own transcript
 * (`<session folder>/subagents/agent-<id>.jsonl`): the truth, where the call's `model` is only the
 * request. The path is built here from the session folder and the agent id, never taken from the
 * renderer, and confined to the subagents folder by real path.
 */
export class SubagentModelReader {
  /** Invalidated by the file's size or mtime changing, and not looked at again for `SUBAGENT_REFRESH_MS`. */
  private readonly cache = new Map<string, Cached>()

  constructor(private readonly now: () => number = Date.now) {}

  /** `sessionFile` is the session's transcript; its sibling folder named for the session holds the agents. */
  async read(sessionFolder: string, agentId: string, requested: BackgroundTaskModel | null): Promise<BackgroundTaskModel> {
    if (!AGENT_ID.test(agentId)) return requested ?? NOT_KNOWN
    const dir = join(sessionFolder, 'subagents')
    const real = await realPathInside(dir, join(dir, `agent-${agentId}.jsonl`))
    if (real !== null) {
      const found = await this.fromTranscript(real)
      if (found !== null) return found
    }
    const meta = await metaModel(dir, agentId)
    return { model: meta ?? requested?.model ?? null, effort: requested?.effort ?? null }
  }

  private async fromTranscript(path: string): Promise<BackgroundTaskModel | null> {
    const cached = this.cache.get(path)
    const at = this.now()
    if (cached !== undefined && at - cached.readAt < SUBAGENT_REFRESH_MS) return nullIfUnknown(cached.value)
    try {
      const { size, mtimeMs } = await stat(path)
      if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) {
        cached.readAt = at
        return nullIfUnknown(cached.value)
      }
      const value = modelFromTail(await readTail(path, SUBAGENT_TAIL_BYTES)) ?? NOT_KNOWN
      this.cache.set(path, { size, mtimeMs, readAt: at, value })
      return nullIfUnknown(value)
    } catch {
      return null
    }
  }
}

const nullIfUnknown = (v: BackgroundTaskModel): BackgroundTaskModel | null => (v.model === null ? null : v)

/** The alias the caller asked for, from the meta file next to the transcript; null when absent. */
async function metaModel(dir: string, agentId: string): Promise<string | null> {
  const real = await realPathInside(dir, join(dir, `agent-${agentId}.meta.json`))
  if (real === null) return null
  try {
    const meta: unknown = JSON.parse(await readFile(real, 'utf8'))
    return isRecord(meta) ? named(meta.model) : null
  } catch {
    return null
  }
}
