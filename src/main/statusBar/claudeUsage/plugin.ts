import { join } from 'node:path'
import { errorMessage } from '@shared/errors'
import { MAIN_ACCOUNT_ID, usageItemId, type AccountInfo, type AccountsState } from '@shared/domain/accounts'
import type { AccountId } from '@shared/domain/ids'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { log } from '../../log/logger'
import type { StatusBarPlugin, StatusBarPluginContext } from '../types'
import type { ConsentStore } from './consent'
import { CONSENT_PROMPT, readAccessToken } from './credentials'
import { fetchLimits, HttpError, type Limits } from './limits'
import { TokenAggregator, type TokenStats } from './tokens'
import { dashboard, detailSections, statusText, statusTone, type Thresholds } from './present'

/** What the usage plugin needs of `AccountService`: who to poll, where each one's sign-in is, and when that changes. */
export interface UsageAccounts {
  list(): AccountsState
  configRootFor(id: AccountId): string
  onChanged(fn: () => void): () => void
}

export interface ClaudeUsageDeps {
  /** Claude's config root (`~/.claude`, or CLAUDE_CONFIG_DIR) — transcripts and credentials. */
  configRoot: string
  /** Read the macOS Keychain too. Only when `configRoot` is the real one; see credentials.ts. */
  useKeychain: boolean
  /** The user's answer to "may Apiary read Claude Code's token?". Nothing credential-shaped is
   *  touched until it says yes (consent.ts, ADR-0019). One answer covers every account. */
  consent: ConsentStore
  /** The Claude accounts. `null` where there are none to ask (a test harness): main alone is polled. */
  accounts: UsageAccounts | null
  fetchImpl?: typeof fetch
  readKeychain?: (service: string) => Promise<string | undefined>
  now?: () => Date
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

const MAX_BACKOFF_MS = 15 * 60 * 1000

const DESCRIPTION = 'Your Claude plan’s 5-hour and weekly limits in the status bar, with token and cost totals on hover and a dashboard on click. Reads Claude Code’s own sign-in once you allow it; the token is only sent to Anthropic’s usage endpoint.'

const USAGE_SETTINGS: StatusBarPlugin['settings'] = [
  { kind: 'number', key: 'pollIntervalMinutes', label: 'Refresh every (minutes)', default: 5, min: 1, max: 60 },
  { kind: 'number', key: 'warnThreshold', label: 'Warning colour from (%)', default: 80, min: 0, max: 100 },
  { kind: 'number', key: 'dangerThreshold', label: 'Danger colour from (%)', default: 95, min: 0, max: 100 },
  {
    kind: 'number', key: 'highUsageThreshold', label: 'Refresh faster once the 5-hour limit reaches (%)',
    default: 90, min: 0, max: 100,
  },
  {
    kind: 'number', key: 'highUsagePollIntervalSeconds', label: '…refreshing every (seconds)',
    default: 30, min: 5, max: 300,
  },
]

/** Not an error and not a sign-in problem: nothing has been asked of the user's credentials yet. */
const CONSENT_ITEM: Omit<StatusBarItem, 'pluginId'> = {
  id: 'usage', icon: 'gauge', text: 'Claude usage: allow access?', title: 'Claude usage: allow access?',
  tone: 'normal', action: { kind: 'consent', prompt: CONSENT_PROMPT }, detail: [],
}

/** Faster once the 5-hour window is at the high-usage threshold, the moment it matters most. */
function pollDelayMs(
  limits: Limits | undefined,
  setting: <T extends string | number | boolean>(key: string, fallback: T) => T,
): number {
  const five = limits?.fiveHour !== undefined ? Math.round(limits.fiveHour.utilization) : undefined
  if (five !== undefined && five >= setting('highUsageThreshold', 90)) {
    return Math.max(5, setting('highUsagePollIntervalSeconds', 30)) * 1000
  }
  return Math.max(1, setting('pollIntervalMinutes', 5)) * 60_000
}

/** What is known about one account's usage. Limits, errors, backoff and the poll timer are each its own. */
interface AccountState {
  info: AccountInfo
  timer: unknown
  limits: Limits | undefined
  error: string | undefined
  signedOut: boolean
  backoffMs: number
  inFlight: Promise<void> | null
}

/** The status-bar item for what is known so far: limits, a sign-in problem, an error, or loading. */
function usageItem(
  { id, limits, signedOut, error, detail, thresholds }: {
    id: string; limits: Limits | undefined; signedOut: boolean; error: string | undefined
    detail: StatusBarItem['detail']; thresholds: Thresholds
  },
): Omit<StatusBarItem, 'pluginId'> {
  if (limits !== undefined) {
    return {
      id, icon: 'gauge', text: statusText(limits), title: 'Claude usage',
      tone: statusTone(limits, thresholds), stale: error !== undefined, action: { kind: 'panel' }, detail,
    }
  }
  if (signedOut) return { id, icon: 'alert', text: 'Claude: sign in', title: error ?? '', tone: 'normal', action: { kind: 'panel' }, detail }
  if (error !== undefined) return { id, icon: 'alert', text: 'Claude: unavailable', title: error, tone: 'normal', action: { kind: 'panel' }, detail }
  return { id, icon: 'gauge', text: 'Claude', title: 'Loading Claude usage…', tone: 'normal', busy: true, action: { kind: 'none' }, detail: [] }
}

/** With several accounts an item says whose it is; with one, it reads exactly as it always did. */
function labelled(item: Omit<StatusBarItem, 'pluginId'>, label: string): Omit<StatusBarItem, 'pluginId'> {
  return { ...item, text: `${label} · ${item.text}`, title: item.title === '' ? label : `${item.title} (${label})` }
}

/** One account's sign-in read and one fetch of its limits, recorded on `acc`. */
async function pollLimits(
  acc: AccountState,
  consent: NonNullable<ReturnType<ConsentStore['proof']>>,
  deps: ClaudeUsageDeps,
  accounts: UsageAccounts,
  { now, setting }: { now: () => Date; setting: <T extends string | number | boolean>(key: string, fallback: T) => T },
): Promise<void> {
  const main = acc.info.id === MAIN_ACCOUNT_ID
  const folder = main ? deps.configRoot : accounts.configRootFor(acc.info.id)
  const token = await readAccessToken(consent, {
    configRoot: folder, accountFolder: main ? null : folder, useKeychain: deps.useKeychain,
    ...(deps.readKeychain !== undefined ? { readKeychain: deps.readKeychain } : {}),
  })
  if (token === undefined) {
    acc.signedOut = true
    acc.limits = undefined
    acc.error = 'Claude Code credentials not found. Sign in with `claude /login` first.'
    return
  }
  acc.signedOut = false
  try {
    acc.limits = await fetchLimits(consent, token, deps.fetchImpl ?? fetch, () => now().getTime())
    acc.error = undefined
    acc.backoffMs = 0
  } catch (e) {
    acc.backoffMs = Math.min(Math.max(acc.backoffMs * 2, pollDelayMs(acc.limits, setting)), MAX_BACKOFF_MS)
    const detail = e instanceof HttpError ? `HTTP ${String(e.status)}` : errorMessage(e)
    acc.error = `Could not reach the usage endpoint (${detail}).`
    log.warn('usage', 'limits fetch failed', { detail })
  }
}

/** The accounts of a caller that has none to offer (a test harness): main alone. */
function mainOnlyAccounts(configRoot: string): UsageAccounts {
  return {
    list: () => ({ accounts: [{ id: MAIN_ACCOUNT_ID, label: 'Main', email: null, isMain: true }], defaultId: MAIN_ACCOUNT_ID }),
    configRootFor: () => configRoot,
    onChanged: () => () => {},
  }
}

function accountItems(
  accountStates: AccountState[],
  o: { several: boolean; stats: TokenStats | undefined; nowMs: number; thresholds: Thresholds; busy: boolean },
): Omit<StatusBarItem, 'pluginId'>[] {
  const out = accountStates.map((acc) => {
    const detail = detailSections({ limits: acc.limits, stats: o.stats, stale: acc.error !== undefined, error: acc.error, now: o.nowMs })
    const item = usageItem({ id: usageItemId(acc.info.id), limits: acc.limits, signedOut: acc.signedOut, error: acc.error, detail, thresholds: o.thresholds })
    return o.several ? labelled(item, acc.info.label) : item
  })
  out.push({ id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now', tone: 'normal', busy: o.busy, action: { kind: 'refresh' }, detail: [] })
  return out
}

/**
 * Claude's usage limits in the status bar — the claude-usage-stats VS Code extension, as an Apiary
 * plugin: the 5-hour and 7-day utilization with the 5-hour reset time, coloured at the warning and
 * danger levels, token and cost totals on hover, and a dashboard on click.
 *
 * One item per signed-in account (main's is `usage`, the others `usage:<id>`), each with its own
 * limits, backoff and poll timer; the renderer shows the one for the focused session's account.
 * Polls every `pollIntervalMinutes`, or every `highUsagePollIntervalSeconds` once the 5-hour window
 * is at `highUsageThreshold` or above (the moment it matters most). A failed fetch keeps the last
 * answer on screen, marked stale, and backs off — never beyond fifteen minutes.
 */
export function createClaudeUsagePlugin(deps: ClaudeUsageDeps): StatusBarPlugin {
  const now = deps.now ?? (() => new Date())
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearT = deps.clearTimeout ?? ((h: unknown) => { clearTimeout(h as NodeJS.Timeout) })
  // The added accounts link their projects folder to main's, so one total serves them all.
  const aggregator = new TokenAggregator(join(deps.configRoot, 'projects'), now)
  const accounts = deps.accounts ?? mainOnlyAccounts(deps.configRoot)

  let ctx: StatusBarPluginContext | null = null
  let offAccounts: (() => void) | null = null
  let stats: TokenStats | undefined
  let busyCount = 0
  const states = new Map<AccountId, AccountState>()
  const setting = <T extends string | number | boolean>(key: string, fallback: T): T => {
    const v = ctx?.settings()[key]
    return (typeof v === typeof fallback ? v : fallback) as T
  }
  const thresholds = (): Thresholds => ({ warn: setting('warnThreshold', 80), danger: setting('dangerThreshold', 95) })

  const schedule = (acc: AccountState, ms: number): void => {
    if (acc.timer !== null) clearT(acc.timer)
    acc.timer = setT(() => {
      acc.timer = null
      void refresh(acc).finally(() => {
        if (ctx !== null && states.get(acc.info.id) === acc) schedule(acc, pollDelayMs(acc.limits, setting) + acc.backoffMs)
      })
    }, ms)
  }

  const refreshOnce = async (acc: AccountState): Promise<void> => {
    // Before anything that touches a credential, the network or the Keychain: the user's answer.
    if (deps.consent.proof() === undefined) return
    busyCount++
    ctx?.changed()
    try {
      try {
        stats = await aggregator.compute()
      } catch (e) {
        // Keep the last totals; the hover says when they were computed.
        log.warn('usage', 'could not total local usage', { error: errorMessage(e) })
      }
      // Asked for again here, not carried over from the check above: an answer given while the
      // transcripts were being totalled must stop the read, not follow it.
      const consent = deps.consent.proof()
      if (consent === undefined) return
      await pollLimits(acc, consent, deps, accounts, { now, setting })
    } finally {
      busyCount--
      ctx?.changed()
    }
  }

  /** Joins a refresh in flight rather than starting a second one beside it. */
  const refresh = (acc: AccountState): Promise<void> => {
    acc.inFlight ??= refreshOnce(acc).finally(() => { acc.inFlight = null })
    return acc.inFlight
  }

  /** Main always; an added account once it is signed in (its `.claude.json` names an email). */
  const polled = (): AccountInfo[] => accounts.list().accounts.filter((a) => a.isMain || a.email !== null)

  const syncAccounts = (): void => {
    const wanted = polled()
    for (const [id, acc] of states) {
      if (wanted.some((a) => a.id === id)) continue
      if (acc.timer !== null) clearT(acc.timer)
      states.delete(id)
    }
    for (const info of wanted) {
      const existing = states.get(info.id)
      if (existing !== undefined) { existing.info = info; continue }
      const acc: AccountState = { info, timer: null, limits: undefined, error: undefined, signedOut: false, backoffMs: 0, inFlight: null }
      states.set(info.id, acc)
      if (ctx !== null) schedule(acc, 0)
    }
    ctx?.changed()
  }

  const eachState = (fn: (acc: AccountState) => void): void => { for (const acc of states.values()) fn(acc) }

  return {
    id: 'claude-usage',
    name: 'Claude usage',
    description: DESCRIPTION,
    defaultEnabled: true,
    settings: USAGE_SETTINGS,
    start(c) {
      ctx = c
      // Switched back on after declining: ask again, as the prompt promised.
      if (deps.consent.state() === 'declined') deps.consent.reset()
      syncAccounts()
      eachState((acc) => { schedule(acc, 0) })
      offAccounts = accounts.onChanged(syncAccounts)
    },
    answerConsent(allow) {
      if (allow) {
        deps.consent.grant()
        eachState((acc) => { acc.backoffMs = 0; schedule(acc, 0) })
      } else {
        deps.consent.decline()
      }
      ctx?.changed()
    },
    stop() {
      ctx = null
      offAccounts?.()
      offAccounts = null
      eachState((acc) => { if (acc.timer !== null) clearT(acc.timer); acc.timer = null })
    },
    settingsChanged() {
      ctx?.changed()
      eachState((acc) => { acc.backoffMs = 0; schedule(acc, 0) })
    },
    refresh: async () => {
      eachState((acc) => { acc.backoffMs = 0 })
      await Promise.all([...states.values()].map(async (acc) => {
        await refresh(acc)
        if (ctx !== null && states.get(acc.info.id) === acc) schedule(acc, pollDelayMs(acc.limits, setting) + acc.backoffMs)
      }))
    },
    items() {
      if (deps.consent.state() !== 'granted') {
        return [CONSENT_ITEM]
      }
      return accountItems([...states.values()], {
        several: accounts.list().accounts.length > 1, stats, nowMs: now().getTime(), thresholds: thresholds(), busy: busyCount > 0,
      })
    },
    async panel(itemId) {
      const acc = [...states.values()].find((a) => usageItemId(a.info.id) === itemId) ?? states.get(MAIN_ACCOUNT_ID)
      return dashboard({ limits: acc?.limits, stats: stats ?? (await aggregator.compute()), error: acc?.error, thresholds: thresholds() })
    },
  }
}
