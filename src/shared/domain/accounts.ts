/**
 * Claude accounts, as the renderer and main both see them. An account is a config folder Claude
 * Code runs under; `main` is the one Apiary already resolves, the others live under
 * `<userData>/accounts/`. The email is read from the folder's `.claude.json` and never stored.
 */
import type { AccountId } from './ids'

export type { AccountId }

/** The account whose behaviour is byte-for-byte what Apiary did before accounts existed. */
export const MAIN_ACCOUNT_ID = 'main' as AccountId

export interface AccountInfo { id: AccountId; label: string; email: string | null; isMain: boolean }
export interface AccountsState { accounts: AccountInfo[]; defaultId: AccountId }

/** Longest label `accountsAdd` accepts. */
const MAX_ACCOUNT_LABEL = 40
const MAX_SLUG = 32

/** A label turned into an id: lowercase `[a-z0-9-]`, at most 32 characters, never `main`, and
 *  unique among `taken` by appending `-2`, `-3`, … */
export function accountSlug(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG).replace(/-+$/, '') || 'account'
  const free = (s: string): boolean => s !== MAIN_ACCOUNT_ID && !taken.has(s)
  if (free(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${String(n)}`
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length)}${suffix}`
    if (free(candidate)) return candidate
  }
}

export function isAccountLabel(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_ACCOUNT_LABEL
}

export function isAccountId(v: unknown): v is AccountId {
  return typeof v === 'string' && /^[a-z0-9-]{1,32}$/.test(v)
}

/** The status-bar item id of an account's usage meter: `usage` for main, `usage:<id>` for the rest. */
export function usageItemId(id: AccountId): string {
  return id === MAIN_ACCOUNT_ID ? 'usage' : `usage:${id}`
}
