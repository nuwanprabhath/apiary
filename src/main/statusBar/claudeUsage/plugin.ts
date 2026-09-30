import { join } from 'node:path'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { log } from '../../log/logger'
import type { StatusBarPlugin, StatusBarPluginContext } from '../types'
import { readAccessToken } from './credentials'
import { fetchLimits, HttpError, type Limits } from './limits'
import { TokenAggregator, type TokenStats } from './tokens'
import { dashboard, detailSections, statusText, statusTone, type Thresholds } from './present'

export interface ClaudeUsageDeps {
  /** Claude's config root (`~/.claude`, or CLAUDE_CONFIG_DIR) — transcripts and credentials. */
  configRoot: string
  /** Read the macOS Keychain too. Only when `configRoot` is the real one; see credentials.ts. */
  useKeychain: boolean
  fetchImpl?: typeof fetch
  readKeychain?: () => Promise<string | undefined>
  now?: () => Date
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

const MAX_BACKOFF_MS = 15 * 60 * 1000

/**
 * Claude's usage limits in the status bar — the claude-usage-stats VS Code extension, as an Apiary
 * plugin: the 5-hour and 7-day utilization with the 5-hour reset time, coloured at the warning and
 * danger levels, token and cost totals on hover, and a dashboard on click.
 *
 * Polls every `pollIntervalMinutes`, or every `highUsagePollIntervalSeconds` once the 5-hour window
 * is at `highUsageThreshold` or above (the moment it matters most). A failed fetch keeps the last
 * answer on screen, marked stale, and backs off — never beyond fifteen minutes.
 */
export function createClaudeUsagePlugin(deps: ClaudeUsageDeps): StatusBarPlugin {
  const now = deps.now ?? (() => new Date())
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearT = deps.clearTimeout ?? ((h: unknown) => { clearTimeout(h as NodeJS.Timeout) })
  const aggregator = new TokenAggregator(join(deps.configRoot, 'projects'), now)

  let ctx: StatusBarPluginContext | null = null
  let timer: unknown = null
  let limits: Limits | undefined
  let stats: TokenStats | undefined
  let error: string | undefined
  let signedOut = false
  let backoffMs = 0
  let busy = false
  let inFlight: Promise<void> | null = null

  const setting = <T extends string | number | boolean>(key: string, fallback: T): T => {
    const v = ctx?.settings()[key]
    return (typeof v === typeof fallback ? v : fallback) as T
  }
  const thresholds = (): Thresholds => ({ warn: setting('warnThreshold', 80), danger: setting('dangerThreshold', 95) })

  const nextPollMs = (): number => {
    const five = limits?.fiveHour !== undefined ? Math.round(limits.fiveHour.utilization) : undefined
    if (five !== undefined && five >= setting('highUsageThreshold', 90)) {
      return Math.max(5, setting('highUsagePollIntervalSeconds', 30)) * 1000
    }
    return Math.max(1, setting('pollIntervalMinutes', 5)) * 60_000
  }

  const schedule = (ms: number): void => {
    if (timer !== null) clearT(timer)
    timer = setT(() => {
      timer = null
      void refresh().finally(() => { if (ctx !== null) schedule(nextPollMs() + backoffMs) })
    }, ms)
  }

  const refreshOnce = async (): Promise<void> => {
    busy = true
    ctx?.changed()
    try {
      try {
        stats = await aggregator.compute()
      } catch {
        // Keep the last totals; the hover says when they were computed.
      }
      const token = await readAccessToken({
        configRoot: deps.configRoot, useKeychain: deps.useKeychain,
        ...(deps.readKeychain !== undefined ? { readKeychain: deps.readKeychain } : {}),
      })
      if (token === undefined) {
        signedOut = true
        limits = undefined
        error = 'Claude Code credentials not found. Sign in with `claude /login` first.'
        return
      }
      signedOut = false
      try {
        limits = await fetchLimits(token, deps.fetchImpl ?? fetch, () => now().getTime())
        error = undefined
        backoffMs = 0
      } catch (e) {
        backoffMs = Math.min(Math.max(backoffMs * 2, nextPollMs()), MAX_BACKOFF_MS)
        const detail = e instanceof HttpError ? `HTTP ${String(e.status)}` : e instanceof Error ? e.message : String(e)
        error = `Could not reach the usage endpoint (${detail}).`
        log.warn('usage', 'limits fetch failed', { detail })
      }
    } finally {
      busy = false
      ctx?.changed()
    }
  }

  /** Joins a refresh in flight rather than starting a second one beside it. */
  const refresh = (): Promise<void> => {
    inFlight ??= refreshOnce().finally(() => { inFlight = null })
    return inFlight
  }

  return {
    id: 'claude-usage',
    name: 'Claude usage',
    description: 'Your Claude plan’s 5-hour and weekly limits in the status bar, with token and cost totals on hover and a dashboard on click. Reads Claude Code’s own sign-in; the token is only sent to Anthropic’s usage endpoint.',
    defaultEnabled: true,
    settings: [
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
    ],
    start(c) {
      ctx = c
      schedule(0)
    },
    stop() {
      ctx = null
      if (timer !== null) clearT(timer)
      timer = null
    },
    settingsChanged() {
      backoffMs = 0
      ctx?.changed()
      schedule(0)
    },
    refresh: async () => {
      backoffMs = 0
      await refresh()
      if (ctx !== null) schedule(nextPollMs())
    },
    items() {
      const nowMs = now().getTime()
      const detail = detailSections({ limits, stats, stale: error !== undefined, error, now: nowMs })
      const main: Omit<StatusBarItem, 'pluginId'> = limits !== undefined
        ? {
            id: 'usage', icon: 'gauge', text: statusText(limits), title: 'Claude usage',
            tone: statusTone(limits, thresholds()), stale: error !== undefined, action: { kind: 'panel' }, detail,
          }
        : signedOut
          ? { id: 'usage', icon: 'alert', text: 'Claude: sign in', title: error ?? '', tone: 'normal', action: { kind: 'panel' }, detail }
          : error !== undefined
            ? { id: 'usage', icon: 'alert', text: 'Claude: unavailable', title: error, tone: 'normal', action: { kind: 'panel' }, detail }
            : { id: 'usage', icon: 'gauge', text: 'Claude', title: 'Loading Claude usage…', tone: 'normal', busy: true, action: { kind: 'none' }, detail: [] }
      return [
        main,
        { id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now', tone: 'normal', busy, action: { kind: 'refresh' }, detail: [] },
      ]
    },
    async panel() {
      return dashboard({ limits, stats: stats ?? (await aggregator.compute()), error, thresholds: thresholds() })
    },
  }
}
