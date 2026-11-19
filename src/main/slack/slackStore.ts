import { isRecord } from '@shared/guards'
import type { CodeCipher } from '../fs/codeCipher'
import { JsonStore } from '../fs/jsonStore'
import { parseTask, type SlackTask } from './slackTasks'

/** The keychain's shape lives in `fs/codeCipher.ts`; the container imports it from here. */
export type { CodeCipher }

export const NO_KEYCHAIN = 'This machine has no keychain to keep the Slack token in.'

/** A top-level message waiting for the owner's "still want it?" answer. */
export interface AwaitingMessage { ts: string; text: string; askedAt: number }

export interface SlackFile {
  enabled: boolean
  /** The token, encrypted by the keychain; never plaintext. */
  token: string | null
  channel: { id: string; name: string } | null
  ownerId: string | null
  /** The `ts` of the newest top-level message handled. */
  cursor: string | null
  tasks: SlackTask[]
  awaiting: AwaitingMessage[]
}

const EMPTY_SLACK_FILE: SlackFile = { enabled: false, token: null, channel: null, ownerId: null, cursor: null, tasks: [], awaiting: [] }

const nonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function parseAwaiting(raw: unknown): AwaitingMessage | null {
  if (!isRecord(raw) || typeof raw.ts !== 'string' || typeof raw.text !== 'string' || typeof raw.askedAt !== 'number' || !Number.isFinite(raw.askedAt)) return null
  return { ts: raw.ts, text: raw.text, askedAt: raw.askedAt }
}

const keep = <T>(raw: unknown, parse: (r: unknown) => T | null): T[] =>
  (Array.isArray(raw) ? raw : []).flatMap((r: unknown) => { const x = parse(r); return x === null ? [] : [x] })

function parseSlackFile(raw: unknown): SlackFile {
  if (!isRecord(raw)) return { ...EMPTY_SLACK_FILE }
  const c = raw.channel
  const channel = isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string' && c.id !== '' ? { id: c.id, name: c.name } : null
  return {
    enabled: raw.enabled === true, token: nonEmptyString(raw.token), channel, ownerId: nonEmptyString(raw.ownerId), cursor: nonEmptyString(raw.cursor),
    tasks: keep(raw.tasks, parseTask), awaiting: keep(raw.awaiting, parseAwaiting),
  }
}

/** `slack.json`: the whole Slack state, with the token only ever encrypted. */
export class SlackStore {
  private readonly store: JsonStore<SlackFile>
  private data: SlackFile

  constructor(file: string, private readonly cipher: CodeCipher | null) {
    this.store = new JsonStore<SlackFile>({ file, version: 1, private: true, parse: parseSlackFile, fallback: () => ({ ...EMPTY_SLACK_FILE }) })
    this.data = this.store.load()
  }

  get state(): Readonly<SlackFile> { return this.data }

  update(change: Partial<SlackFile>): void {
    this.data = { ...this.data, ...change }
    this.store.save(this.data)
  }

  async canStoreToken(): Promise<boolean> { return this.cipher !== null && await this.cipher.available() }

  /** Encrypts and keeps `token`; throws `NO_KEYCHAIN` (writing nothing) where this machine cannot encrypt. */
  async saveToken(token: string): Promise<void> {
    if (this.cipher === null || !(await this.cipher.available())) throw new Error(NO_KEYCHAIN)
    this.update({ token: await this.cipher.encrypt(token) })
  }

  /** The token, or null when none is saved or it can no longer be decrypted (then it is dropped). */
  async token(): Promise<string | null> {
    const encrypted = this.data.token
    if (encrypted === null || this.cipher === null || !(await this.cipher.available())) return null
    try {
      const { text, stale } = await this.cipher.decrypt(encrypted)
      if (stale) await this.saveToken(text)
      return text
    } catch {
      this.update({ token: null })
      return null
    }
  }
}
