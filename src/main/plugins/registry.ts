import { withDefaults } from './types'
import { originUrl } from './remote'
import type {
  PluginBarItem, PluginContext, PluginSettingValues, PluginTarget, SessionBarPlugin,
} from './types'

/**
 * Holds the plugins and asks them all for their contribution to one session's bar.
 *
 * Two rules, both about not letting a plugin damage the app around it:
 *
 * **A plugin that throws contributes nothing, and nothing else notices.** The bar carries git
 * state that matters; an integration failing to reach its API must not take that with it.
 *
 * **A plugin that is slow is answered from the cache.** The bar re-renders whenever the session,
 * the branch or the git status changes, and a plugin that shells out to the network cannot be on
 * that path. Results are cached per folder+branch for `ttlMs`, so switching between two sessions
 * is instant and the network is hit at most once per branch per TTL.
 */

interface CacheEntry {
  at: number
  items: PluginBarItem[]
  /** Kept so a settings change can recompute what is cached without waiting to be asked again. */
  ctx: PluginTarget
  /** Last time this key was actually asked about, via `items()` — separate from `at` (when it was
   *  last *computed*), so a key nobody has drawn the bar for in a while can be told apart from one
   *  that is merely between `ttlMs` refreshes (MAIN-17). */
  lastRead: number
}

/** How long a session's cached plugin answers are kept once nothing has asked about it — a folder
 *  closed, a session no longer open. Without this the cache held one entry per cwd+branch ever
 *  seen, for the life of the process (MAIN-17): a long-running Apiary that had opened hundreds of
 *  folders over weeks kept every one of them, including branches long since deleted. */
const IDLE_EVICT_MS = 10 * 60 * 1000

/** One plugin: what it is, whether it is on, and what the user set for it (before defaults). */
interface PluginRecord {
  plugin: SessionBarPlugin
  enabled: boolean
  settings: PluginSettingValues | undefined
}

/**
 * One folder+branch the bar has been drawn for: its last answer, and the lookup running for it, so
 * a burst of renders produces one lookup rather than ten, and a caller that asks during one *joins*
 * it rather than being handed the stale answer it was trying to get past.
 */
interface TargetRecord {
  cached: CacheEntry | null
  inFlight: Promise<PluginBarItem[]> | null
}

export interface RegistryOptions {
  /** How long a result stays fresh. */
  ttlMs?: number
  /** Injected so tests can drive time. */
  now?: () => number
  /** Called when a background refresh produced something different, so the UI can re-read. */
  onChanged?: () => void
  /** How a folder's remote URL is looked up for `PluginContext.remoteUrl()`; injected so tests
   *  need no git. Defaults to `git remote get-url origin`. */
  remoteUrl?: (cwd: string) => Promise<string | null>
}

const DEFAULT_TTL_MS = 60_000

export class PluginRegistry {
  /** By plugin id, in the order they were registered (the order they are asked and listed in). */
  private readonly plugins = new Map<string, PluginRecord>()
  /** By folder+branch (`key`). The cached answers are invalidated by age (`ttlMs`), by `revalidate`
   *  when an input to `evaluate` changes, by `clearCache`, and dropped when idle (`evictIdle`). */
  private readonly targets = new Map<string, TargetRecord>()
  /**
   * Bumped whenever an input to `evaluate` changes (a setting, a plugin switched on or off). A
   * lookup started under an older value answered with the old inputs: it is not cached as fresh,
   * and it is looked up again. Joining it instead lost a setting changed while it ran, and the bar
   * kept the old target branch for the whole TTL.
   */
  private inputs = 0
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly onChanged: (() => void) | undefined
  private readonly lookupRemote: (cwd: string) => Promise<string | null>

  constructor(options: RegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? (() => Date.now())
    this.onChanged = options.onChanged
    this.lookupRemote = options.remoteUrl ?? ((cwd) => originUrl(cwd))
  }

  register(plugin: SessionBarPlugin, enabled = true): void {
    this.plugins.set(plugin.id, { plugin, enabled, settings: undefined })
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const record = this.plugins.get(pluginId)
    if (record === undefined || record.enabled === enabled) return
    record.enabled = enabled
    this.revalidate()
  }

  /**
   * Replaces a plugin's settings.
   *
   * Clears the cache, because a setting is an input to `evaluate` — changing the target branch and
   * having the button keep the old URL for another minute is exactly the kind of thing that makes
   * a setting look broken.
   */
  setSettings(pluginId: string, values: PluginSettingValues): void {
    const record = this.plugins.get(pluginId)
    if (record === undefined || JSON.stringify(record.settings ?? {}) === JSON.stringify(values)) return
    record.settings = values
    this.revalidate()
  }

  /**
   * Recomputes everything cached, because an input to `evaluate` has changed.
   *
   * Deliberately *not* a `cache.clear()`. Clearing leaves the bar with nothing to show until a
   * fresh lookup lands, so the buttons blink out and — worse — for that moment the window is still
   * holding the answer computed under the old settings, which is a click on a button that does the
   * thing you just changed. Recomputing in place keeps the old answer visible until the new one
   * replaces it, and the replacement announces itself through `onChanged`.
   */
  private revalidate(): void {
    this.inputs += 1
    for (const { cached, inFlight } of [...this.targets.values()]) {
      if (cached === null) continue
      // Marked stale so `items()` does not serve it as fresh while the recompute runs.
      cached.at = Number.NEGATIVE_INFINITY
      // A lookup already running looks again itself when it finishes (`lookup`).
      if (inFlight === null) void this.refresh(cached.ctx)
    }
  }

  /** A plugin's settings with its declared defaults filled in. */
  settingsFor(pluginId: string): PluginSettingValues {
    const record = this.plugins.get(pluginId)
    return withDefaults(record?.plugin.settings ?? [], record?.settings)
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false
  }

  /** Everything Settings needs to draw the Plugins section, including each plugin's own fields. */
  list(): {
    id: string
    name: string
    description: string | null
    enabled: boolean
    fields: NonNullable<SessionBarPlugin['settings']>
    values: PluginSettingValues
  }[] {
    return [...this.plugins.values()].map(({ plugin: p }) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      enabled: this.isEnabled(p.id),
      fields: p.settings ?? [],
      values: this.settingsFor(p.id),
    }))
  }

  private key(ctx: PluginTarget): string {
    return `${ctx.cwd}\0${ctx.branch ?? ''}`
  }

  /**
   * What to draw on the bar right now.
   *
   * Returns the cached answer immediately when there is a fresh one. When there is not, it returns
   * whatever it has — a stale answer, or nothing on the very first call — and refreshes in the
   * background, announcing through `onChanged` when the result actually differs. The bar is never
   * held up by a plugin, which is the whole point: a network call must not decide how fast
   * switching sessions feels.
   */
  items(ctx: PluginTarget): PluginBarItem[] {
    this.evictIdle()
    const key = this.key(ctx)
    const hit = this.targets.get(key)?.cached ?? undefined
    if (hit !== undefined) hit.lastRead = this.now()
    if (hit !== undefined && this.now() - hit.at < this.ttlMs) return hit.items
    void this.refresh(ctx)
    return hit?.items ?? []
  }

  /** Drops any cached session nobody has asked about (via `items()`) for `IDLE_EVICT_MS` — see the
   *  constant's own comment. Swept on every `items()` call rather than on a timer: the cache is
   *  small (one entry per folder+branch a window has actually shown), so an O(n) scan here costs
   *  nothing next to the plugin lookups it might otherwise trigger, and it needs no lifecycle of
   *  its own to start or stop. */
  private evictIdle(): void {
    const cutoff = this.now() - IDLE_EVICT_MS
    for (const [key, target] of this.targets) {
      // A lookup still running is kept: its answer lands in this record.
      if (target.inFlight === null && (target.cached === null || target.cached.lastRead < cutoff)) this.targets.delete(key)
    }
  }

  /** Forces a lookup, ignoring the cache — for an explicit "refresh" and for tests. */
  async refresh(ctx: PluginTarget): Promise<PluginBarItem[]> {
    const key = this.key(ctx)
    const target = this.targetFor(key)
    if (target.inFlight !== null) return target.inFlight
    const promise = this.lookup(ctx, target)
    target.inFlight = promise
    return promise
  }

  private targetFor(key: string): TargetRecord {
    let target = this.targets.get(key)
    if (target === undefined) {
      target = { cached: null, inFlight: null }
      this.targets.set(key, target)
    }
    return target
  }

  private async lookup(target: PluginTarget, record: TargetRecord): Promise<PluginBarItem[]> {
    const inputs = this.inputs
    // One remote lookup per evaluation, shared by every plugin that asks (MAIN-17).
    let remote: Promise<string | null> | undefined
    const ctx: PluginContext = {
      ...target,
      remoteUrl: () => (remote ??= this.lookupRemote(target.cwd)),
    }
    try {
      const results = await Promise.all([...this.plugins.values()].map(async ({ plugin }) => {
        if (!this.isEnabled(plugin.id)) return null
        try {
          const result = await plugin.evaluate(ctx, this.settingsFor(plugin.id))
          // Stamped here rather than trusted from the plugin (MAIN-17): an item can no longer
          // disagree with the plugin that produced it, and a plugin no longer has to know its own
          // id as a string literal repeated at every item it builds.
          return result === null ? null : { ...result, pluginId: plugin.id }
        } catch {
          // Contained on purpose: one integration's bad day is not the bar's.
          return null
        }
      }))
      const items = results.filter((item): item is PluginBarItem => item !== null)
      const before = record.cached
      // A revalidate-triggered recompute (settings/enabled change) is not someone looking at the
      // bar, so it must not reset the idle clock — only `items()` does that.
      const current = inputs === this.inputs
      record.cached = { at: current ? this.now() : Number.NEGATIVE_INFINITY, items, ctx: target, lastRead: before?.lastRead ?? this.now() }
      if (before === null || !sameItems(before.items, items)) this.onChanged?.()
      return items
    } finally {
      record.inFlight = null
      // The inputs changed while this ran: its answer is the old one, so look again now.
      if (inputs !== this.inputs) void this.refresh(target)
    }
  }

  /** Drops every cached answer — used when a setting that plugins read has changed. */
  clearCache(): void {
    for (const target of this.targets.values()) target.cached = null
  }

  /** Releases every plugin that holds something of its own (a timer, a socket) — called once, on
   *  app quit (MAIN-17/MAIN-20). None of the current plugins need this; it exists so a future one
   *  that does is not the first to have to invent a teardown path. */
  dispose(): void {
    for (const { plugin } of this.plugins.values()) plugin.dispose?.()
    this.targets.clear()
  }
}

/** Whether two contributions would draw the same bar, so an unchanged refresh stays silent. */
function sameItems(a: PluginBarItem[], b: PluginBarItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => {
    const other = b[i]
    return item.pluginId === other.pluginId
      && item.id === other.id
      && item.label === other.label
      && item.title === other.title
      && item.tone === other.tone
      && JSON.stringify(item.action) === JSON.stringify(other.action)
  })
}
