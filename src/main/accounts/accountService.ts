import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import {
  MAIN_ACCOUNT_ID, accountSlug, isAccountId, isAccountLabel, type AccountId, type AccountInfo, type AccountsState,
} from '@shared/domain/accounts'
import { asAccountId, type SessionId } from '@shared/domain/ids'
import type { ExecFn } from '../exec/run'
import { JsonStore } from '../fs/jsonStore'
import { fireAndForget } from '../log/fireAndForget'
import { ensureAccountLinks, removeAccountFolder } from './accountFolder'
import { claudeJsonStamp, readOauthEmail, syncClaudeJson } from './claudeJsonSync'

export interface AccountsFile {
  version: 1
  accounts: Array<{ id: string; label: string }>
  defaultId: string
  /** The main account's name when the user renamed it; absent means "Main". */
  mainLabel?: string
}

const MAIN_LABEL = 'Main'

export interface AccountServiceDeps {
  mainRoot: string
  /** `<userData>/accounts`: one folder per added account. */
  accountsDir: string
  homeDir: string
  store: JsonStore<AccountsFile>
  sessions: { get(id: SessionId): string | null; set(id: SessionId, accountId: AccountId): void }
  exec: ExecFn
  platform: NodeJS.Platform
}

/** What the launchers (terminals, chats, one-shot calls) need of the accounts. */
export type LaunchAccounts = Pick<AccountService, 'launchEnv' | 'accountOf' | 'setAccountOf' | 'defaultId'>

/** The `accounts.json` store, built the same way by the app and by tests. */
export function createAccountsStore(file: string): JsonStore<AccountsFile> {
  return new JsonStore<AccountsFile>({
    file, version: 1, parse: parseAccountsFile,
    fallback: () => ({ version: 1, accounts: [], defaultId: MAIN_ACCOUNT_ID }),
  })
}

/** Parse for the `accounts.json` store: total, drops anything malformed. */
export function parseAccountsFile(raw: unknown): AccountsFile {
  const out: AccountsFile = { version: 1, accounts: [], defaultId: MAIN_ACCOUNT_ID }
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.accounts)) {
    for (const a of raw.accounts as unknown[]) {
      // The id names a folder that removing the account deletes, so only a slug is kept: a hand-edited
      // `../x` would otherwise point that delete outside `accounts/`.
      if (isRecord(a) && isAccountId(a.id) && typeof a.label === 'string' && a.id !== MAIN_ACCOUNT_ID
        && !out.accounts.some((x) => x.id === a.id)) out.accounts.push({ id: a.id, label: a.label })
    }
  }
  if (isAccountLabel(raw.mainLabel)) out.mainLabel = raw.mainLabel.trim()
  if (typeof raw.defaultId === 'string' && (raw.defaultId === MAIN_ACCOUNT_ID || out.accounts.some((a) => a.id === raw.defaultId))) {
    out.defaultId = raw.defaultId
  }
  return out
}

/**
 * The accounts Claude Code can run under: the main config root Apiary already resolves, plus any
 * folders the user added, each linked to the main root for history and settings. Only the list and
 * the default live in `accounts.json`; the email is read from the folder's `.claude.json` each
 * time and never stored.
 */
export class AccountService {
  private file: AccountsFile
  private readonly listeners = new Set<() => void>()
  /** Each `.claude.json`'s email by path. Invalidated by the file's stamp (mtime and size), checked on every read. */
  private readonly emailCache = new Map<string, { stamp: string | null; email: string | null }>()
  /** The emails as last announced, so a login or logout made in a terminal is announced once. */
  private announcedLogins = ''

  constructor(private readonly deps: AccountServiceDeps) {
    this.file = deps.store.load()
  }

  list(): AccountsState {
    const added = this.file.accounts.map((a): AccountInfo => ({
      id: asAccountId(a.id), label: a.label, email: this.emailIn(this.folderOf(a.id)), isMain: false,
    }))
    const main: AccountInfo = { id: MAIN_ACCOUNT_ID, label: this.file.mainLabel ?? MAIN_LABEL, email: this.emailIn(null), isMain: true }
    return { accounts: [main, ...added], defaultId: this.defaultId() }
  }

  add(label: string): AccountId {
    const id = asAccountId(accountSlug(label, new Set(this.file.accounts.map((a) => a.id))))
    ensureAccountLinks(this.folderOf(id), this.deps.mainRoot)
    this.update({ ...this.file, accounts: [...this.file.accounts, { id, label: label.trim() }] })
    return id
  }

  /** Renames any account, main included; the id (and so its folder) stays. */
  rename(id: AccountId, label: string): void {
    const name = label.trim()
    if (id === MAIN_ACCOUNT_ID) { this.update({ ...this.file, mainLabel: name }); return }
    if (!this.file.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
    this.update({ ...this.file, accounts: this.file.accounts.map((a) => (a.id === id ? { ...a, label: name } : a)) })
  }

  remove(id: AccountId): void {
    if (id === MAIN_ACCOUNT_ID) throw new Error('The main account cannot be removed')
    if (!this.file.accounts.some((a) => a.id === id)) return
    const folder = this.folderOf(id)
    this.update({
      ...this.file,
      accounts: this.file.accounts.filter((a) => a.id !== id),
      defaultId: this.file.defaultId === id ? MAIN_ACCOUNT_ID : this.file.defaultId,
    })
    fireAndForget(removeAccountFolder(folder, { exec: this.deps.exec, platform: this.deps.platform }), 'accounts')
  }

  setDefault(id: AccountId): void {
    if (id !== MAIN_ACCOUNT_ID && !this.file.accounts.some((a) => a.id === id)) throw new Error(`Unknown account ${id}`)
    this.update({ ...this.file, defaultId: id })
  }

  defaultId(): AccountId {
    return asAccountId(this.file.defaultId)
  }

  /** An id that is unknown, removed or absent resolves to the default account. */
  resolve(id: AccountId | null | undefined): AccountId {
    if (id === MAIN_ACCOUNT_ID) return id
    return id !== null && id !== undefined && this.file.accounts.some((a) => a.id === id) ? id : this.defaultId()
  }

  configRootFor(id: AccountId): string {
    return this.resolve(id) === MAIN_ACCOUNT_ID ? this.deps.mainRoot : this.folderOf(this.resolve(id))
  }

  /** The environment a `claude` for this account runs under: none for main, so it is today's. */
  envFor(id: AccountId): Record<string, string> {
    const resolved = this.resolve(id)
    return resolved === MAIN_ACCOUNT_ID ? {} : { CLAUDE_CONFIG_DIR: this.folderOf(resolved) }
  }

  /** What every launcher asks: `prepareLaunch`, then `envFor`, so no `claude` starts in a half-made account. */
  launchEnv(id: AccountId): Record<string, string> {
    this.prepareLaunch(id)
    return this.envFor(id)
  }

  /** For a `claude` that belongs to no session (a theme, a pet): the default account's. */
  defaultEnv(): Record<string, string> {
    return this.launchEnv(this.defaultId())
  }

  /** Before launching under an account: its links are in place and it shares the main MCP servers and trust. */
  prepareLaunch(id: AccountId): void {
    const resolved = this.resolve(id)
    if (resolved === MAIN_ACCOUNT_ID) return
    const folder = this.folderOf(resolved)
    ensureAccountLinks(folder, this.deps.mainRoot)
    syncClaudeJson(this.claudeJsonIn(null), this.claudeJsonIn(folder))
  }

  accountOf(sessionId: SessionId): AccountId {
    const stored = this.deps.sessions.get(sessionId)
    return this.resolve(stored === null ? null : asAccountId(stored))
  }

  setAccountOf(sessionId: SessionId, id: AccountId): void {
    this.deps.sessions.set(sessionId, id)
  }

  /**
   * A login happens inside a `claude` terminal (`/login`), where Apiary sees nothing but the file
   * Claude rewrites. This compares every account's email with the last announced ones and tells the
   * listeners when one changed: an added account that just logged in, or a global `cswap` switch
   * of the main one. Only a file whose stamp moved is read again.
   */
  checkLogins(): void {
    const now = this.loginsSignature()
    if (now === this.announcedLogins) return
    this.announcedLogins = now
    for (const fn of this.listeners) fn()
  }

  /** `checkLogins` every `intervalMs` until the returned function is called. */
  startLoginChecks(intervalMs = 5000): () => void {
    this.announcedLogins = this.loginsSignature()
    const timer = setInterval(() => { this.checkLogins() }, intervalMs)
    timer.unref()
    return () => { clearInterval(timer) }
  }

  onChanged(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private update(next: AccountsFile): void {
    this.deps.store.save(next)
    this.file = next
    this.announcedLogins = this.loginsSignature()
    for (const fn of this.listeners) fn()
  }

  private loginsSignature(): string {
    return JSON.stringify(this.list().accounts.map((a) => [a.id, a.email]))
  }

  private folderOf(id: string): string {
    if (!isAccountId(id)) throw new Error(`Not an account id: ${id}`)
    return join(this.deps.accountsDir, id)
  }

  /** The main account's `.claude.json` sits in the home folder when the root is `~/.claude`. */
  private claudeJsonIn(folder: string | null): string {
    if (folder !== null) return join(folder, '.claude.json')
    const { mainRoot, homeDir } = this.deps
    return mainRoot === join(homeDir, '.claude') ? join(homeDir, '.claude.json') : join(mainRoot, '.claude.json')
  }

  private emailIn(folder: string | null): string | null {
    const file = this.claudeJsonIn(folder)
    const stamp = claudeJsonStamp(file)
    const cached = this.emailCache.get(file)
    if (cached !== undefined && cached.stamp === stamp) return cached.email
    const email = stamp === null ? null : readOauthEmail(file)
    this.emailCache.set(file, { stamp, email })
    return email
  }
}
