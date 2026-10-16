import { withDefaults } from './types'
import { originUrl } from './remote'
import type {
  PluginBarItem, PluginContext, PluginSettingValues, PluginTarget, SessionBarPlugin,
} from './types'

/**
 * Holds the plugins and asks them all for their contribution to one session's bar.
 *
 * **A plugin that throws contributes nothing, and nothing else notices.**
 *
 * **A slow plugin is answered from the cache.** The bar re-renders on every session, branch or git
 * status change, so a networked plugin cannot be on that path. Results are cached per
 * folder+branch for `ttlMs`.
 */

interface CacheEntry {
  at: number
  items: PluginBarItem[]
  /** Kept so a settings change can recompute what is cached. */
  ctx: PluginTarget
  /** Last time `items()` asked about this key, as opposed to `at` (last computed). */
  lastRead: number
}

/** How long cached plugin answers are kept once nothing asks about them; bounds the cache to what is shown. */
const IDLE_EVICT_MS = 10 * 60 * 1000

/** One plugin: what it is, whether it is on, and what the user set for it (before defaults). */
interface PluginRecord {
  plugin: SessionBarPlugin
  enabled: boolean
  settings: PluginSettingValues | undefined
}

/** One folder+branch the bar has been drawn for: its last answer and the running lookup, which a caller joins. */
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
  /** How a folder's remote URL is looked up for `PluginContext.remoteUrl()`; defaults to `git remote get-url origin`. */
  remoteUrl?: (cwd: string) => Promise<string | null>
}

const DEFAULT_TTL_MS = 60_000

export class PluginRegistry {
  /** By plugin id, in registration order. */
  private readonly plugins = new Map<string, PluginRecord>()
  /** By folder+branch (`key`). The cached answers are invalidated by age (`ttlMs`), by `revalidate`
   *  when an input to `evaluate` changes, by `clearCache`, and dropped when idle (`evictIdle`). */
  private readonly targets = new Map<string, TargetRecord>()
  /**
   * Bumped whenever an input to `evaluate` changes (a setting, a plugin switched on or off). A
   * lookup started under an older value is not cached as fresh and is looked up again; joining it
   * would keep the old inputs for the whole TTL.
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
   * Replaces a plugin's settings, then revalidates: a setting is an input to `evaluate`.
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
   * Not a `cache.clear()`: that would blank the bar until the lookup lands. Recomputing in place
   * keeps the old answer visible until the new one replaces it and announces itself via `onChanged`.
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
   * What to draw on the bar right now: the fresh cached answer, else whatever it has (stale, or
   * nothing on the first call) while refreshing in the background and announcing via `onChanged`
   * when the result differs. The bar is never held up by a plugin.
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

  /** Drops any cached session nobody has asked about for `IDLE_EVICT_MS`; swept on each `items()` call, not on a timer. */
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
    // One remote lookup per evaluation, shared by every plugin that asks.
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
          // Stamped here so an item cannot disagree with its plugin.
          return result === null ? null : { ...result, pluginId: plugin.id }
        } catch {
          return null
        }
      }))
      const items = results.filter((item): item is PluginBarItem => item !== null)
      const before = record.cached
      // A revalidate recompute must not reset the idle clock; only `items()` does.
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

  /** Drops every cached answer. */
  clearCache(): void {
    for (const target of this.targets.values()) target.cached = null
  }

  /** Releases every plugin that holds something of its own (a timer, a socket); called once, on app quit. */
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
