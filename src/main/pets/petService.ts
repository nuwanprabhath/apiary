import { STARTER_PET } from '@shared/pets/builtins'
import { cleanLine, validatePet } from '@shared/pets/validate'
import {
  LINES_JSON_SCHEMA, PET_JSON_SCHEMA, buildChatPrompt, buildCommentPrompt, buildDesignPrompt, buildVoicePrompt,
  extractStructured, extractText, CHAT_HISTORY, type ChatTurn, type VoiceContext,
} from '@shared/pets/prompt'
import { PET_MODELS, type PetModel, type PetRecord, type PetsState } from '@shared/pets/state'
import { ClaudeOneShot } from '../claude/claudeOneShot'
import { log } from '../log/logger'
import type { PetStore } from './petStore'

/** A pet's lines are written afresh at most this often — the "batched voice" the user chose. */
export const VOICE_INTERVAL_MS = 60 * 60 * 1000
/** At most one remark on Claude's work this often, across all pets — about 15 calls an hour, at most. */
export const COMMENT_INTERVAL_MS = 3 * 60 * 1000
const CHAT_REPLY_CHARS = 300

export interface PetServiceDeps {
  store: PetStore
  claudeBin: () => string | null
  /** Something about the pets changed: broadcast `petsChanged`. */
  onChanged: () => void
  now?: () => number
  /** Test-only: the shell to launch claude through. */
  shell?: string
  timeouts?: { design?: number; voice?: number; chat?: number }
}

function cleanReply(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are what is being removed
  const flat = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  return [...flat].slice(0, CHAT_REPLY_CHARS).join('')
}

/**
 * The pets' use of `claude`: designing a pet, writing its lines for the hour, and chatting.
 *
 * Each kind has its own runner, so a chat is never stuck behind a voice refresh or a design. Only
 * counts and session titles go into a voice prompt, never anything said in a session; and nothing
 * a pet or the user says is logged — only which kind of call, the model, how long, and whether it
 * worked. Every answer goes through `validatePet` or the line cleaner before it is kept.
 */
export class PetService {
  private readonly design: ClaudeOneShot
  private readonly voiceRunner: ClaudeOneShot
  private readonly chatRunner: ClaudeOneShot
  private readonly commentRunner: ClaudeOneShot
  private lastComment = -Infinity
  private readonly now: () => number
  private generating = false
  /** When a voice refresh was last tried per pet — a failure waits out the interval too. */
  private readonly voiceTried = new Map<string, number>()
  private readonly history = new Map<string, ChatTurn[]>()

  constructor(private readonly deps: PetServiceDeps) {
    const opts = { claudeBin: deps.claudeBin, ...(deps.shell !== undefined ? { shell: deps.shell } : {}) }
    this.design = new ClaudeOneShot(opts)
    this.voiceRunner = new ClaudeOneShot(opts)
    this.chatRunner = new ClaudeOneShot(opts)
    this.commentRunner = new ClaudeOneShot(opts)
    this.now = deps.now ?? Date.now
  }

  state(): PetsState {
    return { enabled: this.deps.store.enabled, pets: this.deps.store.list(), generating: this.generating }
  }

  /**
   * Turning pets on for the first time hatches one: designed by Haiku from nothing, or the starter
   * pet when that cannot be done — pets on should never mean an empty bar.
   */
  async setEnabled(on: boolean): Promise<void> {
    this.deps.store.setEnabled(on)
    this.deps.onChanged()
    if (!on || this.deps.store.list().length > 0 || this.generating) return
    try {
      await this.generate(null, 'haiku')
    } catch {
      if (this.deps.store.list().length === 0) {
        this.deps.store.add(STARTER_PET)
        this.deps.onChanged()
      }
    }
  }

  async generate(description: string | null, model: PetModel = 'haiku'): Promise<PetRecord> {
    if (this.generating) throw new Error('Already hatching a pet.')
    const m: PetModel = (PET_MODELS as readonly string[]).includes(model) ? model : 'haiku'
    this.generating = true
    this.deps.onChanged()
    const started = this.now()
    try {
      const stdout = await this.design.run({
        prompt: buildDesignPrompt(description), model: m, jsonSchema: PET_JSON_SCHEMA,
        timeoutMs: this.deps.timeouts?.design ?? 120_000, what: 'a pet', tag: 'pet',
      })
      const spec = validatePet(extractStructured(stdout))
      if (spec === null) throw new Error("Claude's reply had no pet in it. Try describing it differently.")
      const pet = this.deps.store.add(spec, { model: m })
      log.info('pets', 'designed', { model: m, ms: this.now() - started, described: description !== null })
      return pet
    } catch (e) {
      log.warn('pets', 'design failed', { model: m, ms: this.now() - started, error: e instanceof Error ? e.message : String(e) })
      throw e
    } finally {
      this.generating = false
      this.deps.onChanged()
    }
  }

  cancelGenerate(): void { this.design.cancel() }

  /**
   * New lines for the hour ahead. False when it is not time yet (or pets are off, or the pet is
   * not out, or another pet's lines are being written) — the renderer simply asks again later.
   */
  async voice(id: string, ctx: VoiceContext): Promise<boolean> {
    const pet = this.deps.store.get(id)
    if (!this.deps.store.enabled || pet === undefined || !pet.active || this.voiceRunner.busy) return false
    const last = Math.max(pet.voicedAt, this.voiceTried.get(id) ?? 0)
    if (this.now() - last < VOICE_INTERVAL_MS) return false
    this.voiceTried.set(id, this.now())
    const started = this.now()
    try {
      const stdout = await this.voiceRunner.run({
        prompt: buildVoicePrompt(pet.spec, ctx), model: pet.model, jsonSchema: LINES_JSON_SCHEMA,
        timeoutMs: this.deps.timeouts?.voice ?? 90_000, what: 'a pet\'s lines', tag: 'pet',
      })
      const raw = extractStructured(stdout)
      const lines = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).lines : undefined
      if (this.deps.store.get(id) === undefined) return false
      this.deps.store.setLines(id, lines, this.now())
      log.info('pets', 'voiced', { model: pet.model, ms: this.now() - started })
      this.deps.onChanged()
      return true
    } catch (e) {
      log.warn('pets', 'voice failed', { model: pet.model, ms: this.now() - started, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  async chat(id: string, message: string): Promise<string> {
    const pet = this.deps.store.get(id)
    if (pet === undefined) throw new Error('No such pet.')
    const text = message.trim()
    if (text === '') throw new Error('Say something first.')
    if (this.chatRunner.busy) throw new Error(`${pet.spec.name} is still thinking.`)
    const past = this.history.get(id) ?? []
    const started = this.now()
    try {
      const stdout = await this.chatRunner.run({
        prompt: buildChatPrompt(pet.spec, past, text), model: pet.model,
        timeoutMs: this.deps.timeouts?.chat ?? 60_000, what: 'a reply', tag: 'pet',
      })
      const answer = extractText(stdout)
      const reply = answer === null ? '' : cleanReply(answer)
      if (reply === '') throw new Error(`${pet.spec.name} didn't answer. Try again.`)
      this.history.set(id, [...past, { from: 'you' as const, text }, { from: 'pet' as const, text: reply }].slice(-CHAT_HISTORY))
      log.info('pets', 'chat', { model: pet.model, ms: this.now() - started })
      return reply
    } catch (e) {
      log.warn('pets', 'chat failed', { model: pet.model, ms: this.now() - started, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  /**
   * A pet's remark on what Claude is doing. Null when it is not time for another (one every
   * `COMMENT_INTERVAL_MS` across all pets), pets are off, or the model had nothing usable to say.
   * `action` came through the renderer, so it is cleaned again here.
   */
  async comment(id: string, action: string): Promise<string | null> {
    const pet = this.deps.store.get(id)
    const what = cleanLine(action)
    if (!this.deps.store.enabled || pet === undefined || !pet.active || what === null || this.commentRunner.busy) return null
    if (this.now() - this.lastComment < COMMENT_INTERVAL_MS) return null
    this.lastComment = this.now()
    const started = this.now()
    try {
      const stdout = await this.commentRunner.run({
        prompt: buildCommentPrompt(pet.spec, what), model: pet.model,
        timeoutMs: this.deps.timeouts?.chat ?? 60_000, what: 'a remark', tag: 'pet',
      })
      const text = extractText(stdout)
      log.info('pets', 'comment', { model: pet.model, ms: this.now() - started })
      return text === null ? null : cleanLine(text.replace(/^["“]|["”]$/g, ''))
    } catch (e) {
      log.warn('pets', 'comment failed', { model: pet.model, ms: this.now() - started, error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  forget(id: string): void {
    this.history.delete(id)
    this.voiceTried.delete(id)
  }

  dispose(): void {
    this.design.cancel()
    this.voiceRunner.cancel()
    this.chatRunner.cancel()
    this.commentRunner.cancel()
  }
}
