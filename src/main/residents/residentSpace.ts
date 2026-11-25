import type { Dirent } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import { RESIDENT_ID_RE } from '@shared/settings/residents'
import { realPathInside } from '../fs/confine'
import type { ResidentAttention, ResidentMessage } from '@shared/domain/residents'
import { JsonStore } from '../fs/jsonStore'
import { ensurePrivateDir, writePrivateJson } from '../fs/atomicWrite'

/** The newest mtime of `path` and everything under it, read with `lstat` so a symlink is never followed. */
async function newestMtimeMs(path: string): Promise<number> {
  const info = await lstat(path)
  if (!info.isDirectory()) return info.mtimeMs
  let newest = info.mtimeMs
  for (const name of await readdir(path)) newest = Math.max(newest, await newestMtimeMs(join(path, name)))
  return newest
}

/** The visible chat keeps this many messages; claude's own session (`--resume`) keeps the rest. */
/** How long claude waits on an Apiary tool call: a card stays until the person answers it. */
export const TOOL_WAIT_MS = 12 * 60 * 60 * 1000

const MAX_HISTORY = 500
export const NOTE_KEY_MAX = 80
export const NOTE_TEXT_MAX = 4000
const NOTES_MAX = 500

const isMessage = (v: unknown): v is ResidentMessage =>
  isRecord(v) && typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant')
  && typeof v.text === 'string' && typeof v.at === 'number'
  && (v.via === undefined || v.via === 'slack') && (v.note === undefined || v.note === true)

interface History { messages: ResidentMessage[] }
interface ChatState { claudeSessionId: string | null; attention: ResidentAttention | null }

export const ATTENTION_SUMMARY_MAX = 200
export const ATTENTION_COUNT_MAX = 999

const isAttention = (v: unknown): v is ResidentAttention =>
  isRecord(v) && typeof v.count === 'number' && Number.isInteger(v.count) && v.count >= 0 && v.count <= ATTENTION_COUNT_MAX
  && typeof v.summary === 'string' && v.summary.length <= ATTENTION_SUMMARY_MAX
interface Notes { notes: Record<string, string> }

/**
 * A resident's private folder, `userData/residents/<id>/` (mode 0700): its chat history, its
 * claude session id, its notes, its MCP config and claude's working directory. The id is a slug
 * (`RESIDENT_ID_RE`, enforced by the setting), so it cannot leave `root`.
 */
export class ResidentSpace {
  readonly dir: string
  private readonly history: JsonStore<History>
  private readonly state: JsonStore<ChatState>
  private readonly notesStore: JsonStore<Notes>

  constructor(root: string, id: string) {
    this.dir = join(root, id)
    this.history = new JsonStore<History>({
      file: join(this.dir, 'history.json'),
      version: 1,
      // A message that was streaming when Apiary quit is kept as far as it got.
      parse: (raw) => ({
        messages: isRecord(raw) && Array.isArray(raw.messages)
          ? raw.messages.filter(isMessage).map((m) => ({ ...m, streaming: false })).slice(-MAX_HISTORY)
          : [],
      }),
      fallback: () => ({ messages: [] }),
    })
    this.state = new JsonStore<ChatState>({
      file: join(this.dir, 'state.json'),
      version: 1,
      parse: (raw) => ({
        claudeSessionId: isRecord(raw) && typeof raw.claudeSessionId === 'string' ? raw.claudeSessionId : null,
        attention: isRecord(raw) && isAttention(raw.attention) ? raw.attention : null,
      }),
      fallback: () => ({ claudeSessionId: null, attention: null }),
    })
    this.notesStore = new JsonStore<Notes>({
      file: join(this.dir, 'notes.json'),
      version: 1,
      parse: (raw) => ({
        notes: isRecord(raw) && isRecord(raw.notes)
          ? Object.fromEntries(Object.entries(raw.notes).filter((e): e is [string, string] => typeof e[1] === 'string'))
          : {},
      }),
      fallback: () => ({ notes: {} }),
    })
  }

  /** Makes the folder (0700) before anything is written into it or claude runs in it. */
  ensure(): void { ensurePrivateDir(this.dir) }

  loadHistory(): ResidentMessage[] { return this.history.load().messages }
  saveHistory(messages: ResidentMessage[]): void {
    this.ensure()
    this.history.save({ messages: messages.slice(-MAX_HISTORY) })
  }

  claudeSessionId(): string | null { return this.state.load().claudeSessionId }
  setClaudeSessionId(id: string | null): void {
    this.ensure()
    this.state.save({ ...this.state.load(), claudeSessionId: id })
  }

  /** What it needs the user for; kept across restarts until the user opens its popup. */
  attention(): ResidentAttention | null { return this.state.load().attention }
  /** How many times the attention was written since this space was opened, so a turn can tell whether it was set or cleared during it. */
  attentionWrites = 0
  setAttention(attention: ResidentAttention | null): void {
    this.attentionWrites += 1
    this.ensure()
    this.state.save({ ...this.state.load(), attention })
  }

  notes(): Record<string, string> { return this.notesStore.load().notes }
  /** Sets or replaces a note; throws past the caps, with the reason the agent is told. */
  putNote(key: string, text: string): void {
    if (key.trim() === '' || key.length > NOTE_KEY_MAX) throw new Error(`A note key is 1 to ${String(NOTE_KEY_MAX)} characters.`)
    if (text.length > NOTE_TEXT_MAX) throw new Error(`A note is at most ${String(NOTE_TEXT_MAX)} characters.`)
    const notes = this.notes()
    if (!Object.hasOwn(notes, key) &&Object.keys(notes).length >= NOTES_MAX) throw new Error(`There are already ${String(NOTES_MAX)} notes; replace one instead.`)
    this.ensure()
    this.notesStore.save({ notes: { ...notes, [key]: text } })
  }

  /**
   * The `--mcp-config` file claude reads: the server's address, this resident's token (0600), and
   * how long claude lets a call sit silent (`timeout`). Without it claude drops a call after 300 s
   * of "no response or progress", which ended a card the person had not answered yet.
   */
  /** Drops history entries written before `cutoffMs` (epoch); returns how many went. */
  pruneHistoryOlderThan(cutoffMs: number): number {
    const messages = this.loadHistory()
    const kept = messages.filter((m) => m.at >= cutoffMs)
    if (kept.length !== messages.length) this.saveHistory(kept)
    return messages.length - kept.length
  }

  /** Empties the notes and the MR desk's working state (`mra/state`); history goes through the chat's own clear. */
  async clearNotesAndState(): Promise<void> {
    this.notesStore.save({ notes: {} })
    const state = await realPathInside(this.dir, join(this.dir, 'mra', 'state'))
    if (state !== null) await rm(state, { recursive: true, force: true })
  }

  /**
   * Removes every `<id>/` folder under `root` that no live resident owns. Only a resident-shaped
   * name, only a real directory (a symlink is never followed), only inside `root` by real path, and
   * only when nothing in it was modified at or after `untouchedSinceMs` (epoch): a misread of the
   * settings, or a resident removed and added back, must not cost a live chat. Returns the ids removed.
   */
  static async removeOrphans(root: string, liveIds: Set<string>, untouchedSinceMs: number): Promise<string[]> {
    let entries: Dirent[]
    try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
    const removed: string[] = []
    for (const entry of entries) {
      if (liveIds.has(entry.name) || !RESIDENT_ID_RE.test(entry.name) || !entry.isDirectory()) continue
      const full = await realPathInside(root, join(root, entry.name))
      if (full === null || full === (await realPathInside(root, root))) continue
      if (await newestMtimeMs(full) >= untouchedSinceMs) continue
      await rm(full, { recursive: true, force: true })
      removed.push(entry.name)
    }
    return removed
  }

  writeMcpConfig(url: string, token: string): string {
    this.ensure()
    const file = join(this.dir, 'mcp.json')
    writePrivateJson(file, { mcpServers: { apiary: { type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: TOOL_WAIT_MS } } })
    return file
  }
}
