import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import type { ResidentAttention, ResidentMessage } from '@shared/domain/residents'
import { JsonStore } from '../fs/jsonStore'
import { ensurePrivateDir, writePrivateJson } from '../fs/atomicWrite'

/** The visible chat keeps this many messages; claude's own session (`--resume`) keeps the rest. */
const MAX_HISTORY = 500
export const NOTE_KEY_MAX = 80
export const NOTE_TEXT_MAX = 4000
const NOTES_MAX = 500

const isMessage = (v: unknown): v is ResidentMessage =>
  isRecord(v) && typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant')
  && typeof v.text === 'string' && typeof v.at === 'number'

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
  setAttention(attention: ResidentAttention | null): void {
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

  /** The `--mcp-config` file claude reads: the server's address and this resident's token (0600). */
  writeMcpConfig(url: string, token: string): string {
    this.ensure()
    const file = join(this.dir, 'mcp.json')
    writePrivateJson(file, { mcpServers: { apiary: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } })
    return file
  }
}
