import type { TerminalRef } from '@shared/domain/ids'
import type { StatusBarItem, StatusBarPanel } from '@shared/domain/statusBar'
import type { GitService } from '../git/gitService'
import type { SessionResolver } from '../sessions/sessionResolver'
import { BUILTIN_STATUS_BAR_PLUGINS } from '../statusBar/builtin'
import type { RemoteClientsFeed } from '../statusBar/remoteClients'
import type { StatusBarRegistry } from '../statusBar/registry'
import { ConsentStore, memoryConsentStorage, type ConsentStorage } from '../statusBar/claudeUsage/consent'
import type { UsageAccounts } from '../statusBar/claudeUsage/plugin'
import { usageStandIn } from '../statusBar/claudeUsage/standIn'
import { BUILTIN_PLUGINS } from './builtin'
import type { PluginRegistry } from './registry'
import type { PluginBarItem, PluginSettingValues } from './types'

interface BuiltinPluginConfig {
  /** Which plugins are switched on, by plugin id (`settings.plugins`). */
  enabled: Record<string, boolean> | undefined
  /** Each plugin's own settings, by plugin id (`settings.pluginSettings`). */
  settings: Record<string, PluginSettingValues> | undefined
  /** Path to `glab`, for anyone whose install is not on PATH (and for tests). */
  glabPath: string | undefined
  /** Claude Code's config root, for the usage plugin. */
  configRoot: string
  /** Whether the usage plugin may read the macOS Keychain (never against a test fixture's root). */
  useKeychain: boolean
  /** The Claude accounts the usage meter follows; null where there are none (a test harness). */
  accounts: UsageAccounts | null
  /** Where the usage plugin's consent answer is remembered. Omitted: in memory, asked each launch. */
  consent?: ConsentStorage
  /** Test-only: what the usage plugin reads and fetches instead of the real sign-in and endpoint. */
  fakeUsage?: string
  /** Remembers that a plugin was switched off by the user's own answer (a declined consent), so it
   *  stays off at the next launch. Omitted: only this run. */
  persistEnabled?: (pluginId: string, enabled: boolean) => void
  /** Who is connected over remote access, for the status bar. */
  remoteClients?: RemoteClientsFeed
}

export interface PluginServiceDeps {
  plugins: PluginRegistry
  statusBar: StatusBarRegistry
  resolver: SessionResolver
  git: GitService
  /**
   * The built-in plugins to register. Omitted, nothing is: a caller that hands in registries it
   * has filled itself (a test) has already decided what is in them, and registering the built-ins
   * on top would silently add a plugin its fake registry never asked for.
   */
  builtins?: BuiltinPluginConfig
}

/**
 * The session-bar and status-bar plugins: both registries, how the built-ins are registered, and what a plugin is asked
 * about (a session's folder and branch). Settings has one Plugins section for both kinds, so
 * enabling and configuring go through here and find the registry that owns the id.
 */
export class PluginService {
  private readonly plugins: PluginRegistry
  private readonly statusBar: StatusBarRegistry
  private readonly resolver: SessionResolver
  private readonly git: GitService
  private readonly persistEnabled: (pluginId: string, enabled: boolean) => void

  constructor(deps: PluginServiceDeps) {
    this.plugins = deps.plugins
    this.statusBar = deps.statusBar
    this.resolver = deps.resolver
    this.git = deps.git
    this.persistEnabled = deps.builtins?.persistEnabled ?? (() => {})
    const config = deps.builtins
    if (config === undefined) return
    // What the user has set wins over the plugin's own `defaultEnabled`.
    for (const factory of BUILTIN_PLUGINS) {
      const plugin = factory({ glabPath: config.glabPath })
      this.plugins.register(plugin, config.enabled?.[plugin.id] ?? plugin.defaultEnabled ?? true)
    }
    for (const factory of BUILTIN_STATUS_BAR_PLUGINS) {
      const plugin = factory({
        configRoot: config.configRoot,
        useKeychain: config.fakeUsage !== undefined || config.useKeychain,
        ...(config.fakeUsage !== undefined ? usageStandIn(config.fakeUsage) : {}),
        accounts: config.accounts,
        consent: new ConsentStore(config.fakeUsage !== undefined ? memoryConsentStorage('granted') : config.consent ?? memoryConsentStorage()),
        remoteClients: config.remoteClients,
      })
      this.statusBar.register(plugin, config.enabled?.[plugin.id] ?? plugin.defaultEnabled ?? true)
    }
    for (const [id, values] of Object.entries(config.settings ?? {})) this.setSettings(id, values)
  }

  /**
   * What the session-bar plugins would put on this session's bar.
   *
   * Synchronous from the cache — the bar redraws on every git-status poll, and a plugin that talks
   * to the network cannot be on that path. A cold or stale answer refreshes in the background and
   * announces itself through the registry's `onChanged`.
   */
  barItems(terminal: TerminalRef): PluginBarItem[] {
    const ctx = this.contextOf(terminal)
    return ctx === null ? [] : this.plugins.items(ctx)
  }

  async refreshBar(terminal: TerminalRef): Promise<PluginBarItem[]> {
    const ctx = this.contextOf(terminal)
    return ctx === null ? [] : this.plugins.refresh(ctx)
  }

  /** Null, not a throw, for a session whose folder has gone: its bar is still drawn, without plugin buttons. */
  private contextOf(terminal: TerminalRef): { cwd: string; branch: string | null } | null {
    let cwd: string
    try {
      cwd = this.resolver.resolveShellCwd(terminal)
    } catch {
      return null
    }
    return { cwd, branch: this.git.lastBranchFor(cwd) }
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    if (this.statusBar.has(pluginId)) this.statusBar.setEnabled(pluginId, enabled)
    else this.plugins.setEnabled(pluginId, enabled)
  }

  setSettings(pluginId: string, values: PluginSettingValues): void {
    if (this.statusBar.has(pluginId)) this.statusBar.setSettings(pluginId, values)
    else this.plugins.setSettings(pluginId, values)
  }

  list(): ReturnType<PluginRegistry['list']> {
    return [...this.plugins.list(), ...this.statusBar.list()]
  }

  statusBarItems(): StatusBarItem[] {
    return this.statusBar.items()
  }

  async statusBarRefresh(pluginId: string): Promise<void> {
    return this.statusBar.refresh(pluginId)
  }

  /**
   * The user's answer to a status-bar plugin's consent prompt. Declining switches the plugin off
   * and remembers that it is off; the plugin asks again only if the user turns it back on.
   */
  statusBarConsent(pluginId: string, allow: boolean): void {
    if (!this.statusBar.answerConsent(pluginId, allow)) return
    if (allow) return
    this.statusBar.setEnabled(pluginId, false)
    this.persistEnabled(pluginId, false)
  }

  async statusBarPanel(pluginId: string, itemId: string): Promise<StatusBarPanel | null> {
    return this.statusBar.panel(pluginId, itemId)
  }

  /** Starts the status-bar plugins' own schedules. Separate from construction so that building the
   *  services (every integration test does) never starts a network poll. */
  startStatusBar(): void {
    this.statusBar.start()
  }

  stopStatusBar(): void {
    this.statusBar.stop()
  }

  dispose(): void {
    this.plugins.dispose()
  }
}
