import { isRecord } from '@shared/guards'
import type { CodeCipher } from '../fs/codeCipher'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'
import { parseTask, type SlackTask } from './slackTasks'

/** The keychain's shape lives in `fs/codeCipher.ts`; the container imports it from here. */
export type { CodeCipher }

export const NO_KEYCHAIN = 'This machine has no keychain to keep the Slack token in.'

/** A top-level message waiting for the owner's "still want it?" answer. */
export interface AwaitingMessage { ts: string; text: string; askedAt: number }

/** What the file keeps of an awaiting message: `sealed` is the text encrypted; a plain `text` is an older file's and is sealed on load. */
interface DiskAwaiting { ts: string; askedAt: number; sealed?: string; text?: string }

interface SlackFileBase {
  enabled: boolean
  /** The token, encrypted by the keychain; never plaintext. */
  token: string | null
  channel: { id: string; name: string } | null
  ownerId: string | null
  /** The `ts` of the newest top-level message handled. */
  cursor: string | null
  tasks: SlackTask[]
  /** Set once the Slack consent was carried over from the days before Settings → Privacy, so a later revoke is never undone. */
  slackConsentMigrated: boolean
}

/** The state as the bridge sees it: awaiting texts in the clear (in memory only). */
export interface SlackFile extends SlackFileBase { awaiting: AwaitingMessage[] }

interface DiskFile extends SlackFileBase { awaiting: DiskAwaiting[] }

const EMPTY_DISK: DiskFile = { enabled: false, token: null, channel: null, ownerId: null, cursor: null, tasks: [], awaiting: [], slackConsentMigrated: false }

const nonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function parseAwaiting(raw: unknown): DiskAwaiting | null {
  if (!isRecord(raw) || typeof raw.ts !== 'string' || typeof raw.askedAt !== 'number' || !Number.isFinite(raw.askedAt)) return null
  const sealed = nonEmptyString(raw.sealed)
  if (sealed !== null) return { ts: raw.ts, askedAt: raw.askedAt, sealed }
  return typeof raw.text === 'string' ? { ts: raw.ts, askedAt: raw.askedAt, text: raw.text } : null
}

const keep = <T>(raw: unknown, parse: (r: unknown) => T | null): T[] =>
  (Array.isArray(raw) ? raw : []).flatMap((r: unknown) => { const x = parse(r); return x === null ? [] : [x] })

function parseSlackFile(raw: unknown): DiskFile {
  if (!isRecord(raw)) return { ...EMPTY_DISK }
  const c = raw.channel
  const channel = isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string' && c.id !== '' ? { id: c.id, name: c.name } : null
  return {
    enabled: raw.enabled === true, token: nonEmptyString(raw.token), channel, ownerId: nonEmptyString(raw.ownerId), cursor: nonEmptyString(raw.cursor),
    tasks: keep(raw.tasks, parseTask), awaiting: keep(raw.awaiting, parseAwaiting), slackConsentMigrated: raw.slackConsentMigrated === true,
  }
}

/** `slack.json`: the whole Slack state, with the token and the awaiting texts only ever encrypted. */
export class SlackStore {
  private readonly store: JsonStore<DiskFile>
  private data: SlackFile
  private readonly loaded: Promise<void>
  /** Each awaiting message's ciphertext, for the text it was made from. Invalidated by a change of that text. */
  private readonly sealedBy = new Map<string, { text: string; sealed: string }>()
  private sealing: Promise<void> = Promise.resolve()

  constructor(file: string, private readonly cipher: CodeCipher | null) {
    this.store = new JsonStore<DiskFile>({ file, version: 1, private: true, parse: parseSlackFile, fallback: () => ({ ...EMPTY_DISK }) })
    const disk = this.store.load()
    this.data = { ...disk, awaiting: [] }
    this.loaded = this.openAwaiting(disk.awaiting)
  }

  get state(): Readonly<SlackFile> { return this.data }

  /** Settles when the awaiting messages of the file are decrypted (and an older plaintext file is encrypted). */
  ready(): Promise<void> { return this.loaded }

  update(change: Partial<SlackFile>): void {
    this.data = { ...this.data, ...change }
    this.write()
    if (change.awaiting !== undefined) this.seal()
  }

  private write(): void {
    const awaiting = this.data.awaiting.flatMap((a): DiskAwaiting[] => {
      const known = this.sealedBy.get(a.ts)
      return known?.text === a.text ? [{ ts: a.ts, askedAt: a.askedAt, sealed: known.sealed }] : []
    })
    this.store.save({ ...this.data, awaiting })
  }

  /** Encrypts the awaiting texts not yet encrypted, then writes; without a keychain they stay in memory only. */
  private seal(): void {
    this.sealing = this.sealing.then(async () => {
      if (this.cipher === null || !(await this.cipher.available())) return
      let added = false
      for (const a of this.data.awaiting) {
        if (this.sealedBy.get(a.ts)?.text === a.text) continue
        this.sealedBy.set(a.ts, { text: a.text, sealed: await this.cipher.encrypt(a.text) })
        added = true
      }
      if (added) this.write()
    }).catch(() => { log.warn('slack', 'could not encrypt the waiting messages') })
  }

  private async openAwaiting(entries: DiskAwaiting[]): Promise<void> {
    let dropped = 0
    const opened: AwaitingMessage[] = []
    for (const e of entries) {
      if (e.sealed === undefined) { opened.push({ ts: e.ts, text: e.text ?? '', askedAt: e.askedAt }); continue }
      try {
        if (this.cipher === null) throw new Error('no keychain')
        const { text } = await this.cipher.decrypt(e.sealed)
        this.sealedBy.set(e.ts, { text, sealed: e.sealed })
        opened.push({ ts: e.ts, text, askedAt: e.askedAt })
      } catch {
        dropped += 1
      }
    }
    if (dropped > 0) log.warn('slack', 'dropped waiting messages that could not be decrypted', { count: dropped })
    const have = new Set(this.data.awaiting.map((a) => a.ts))
    this.data = { ...this.data, awaiting: [...opened.filter((a) => !have.has(a.ts)), ...this.data.awaiting] }
    this.write()
    this.seal()
    await this.sealing
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
