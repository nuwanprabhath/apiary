/**
 * Session bar plugins.
 *
 * The bar under a session (shell toggle, branch, pull/push) takes contributions from plugins
 * instead of growing a hardcoded button for each provider.
 *
 * The shape of a plugin is deliberately narrow:
 *
 * - It is asked a question — "given this folder and this branch, what would you put on the bar?"
 *   — and answers with a description of a button, or with nothing.
 * - It never returns markup. The main process has no JSX, and a plugin that could inject markup
 *   into the renderer would be a plugin that could do anything to the window. An `icon` is one of
 *   a fixed set of names the renderer knows how to draw.
 * - It never receives a path from the renderer. Like every other main-process entry point here,
 *   the working directory is resolved from an id the main process already trusts.
 * - Clicking is described as data too (`action`), not as a callback, so the only things a click
 *   can do are the things listed here. Today that is "open this URL in a browser", checked
 *   against an allowlist of schemes before anything is opened.
 */

import type { PluginSettingField, PluginSettingValues, PluginBarItem } from '@shared/domain/plugins'

// Canonical definitions live in shared/domain/plugins.ts: the renderer draws these same shapes.
// Re-exported for `from './types'` imports in this directory.
export type {
  PluginSettingField, PluginSettingValues, PluginBarItem,
} from '@shared/domain/plugins'

/** Fills in anything the user has not set, so a plugin never has to check for absence. */
export function withDefaults(
  fields: PluginSettingField[],
  values: PluginSettingValues | undefined,
): PluginSettingValues {
  const out: PluginSettingValues = {}
  for (const field of fields) {
    const value = values?.[field.key]
    // A value of the wrong type is treated as absent: settings.json is a file people edit, and a
    // string where a number belongs must not reach a plugin as one.
    out[field.key] = typeof value === typeof field.default && value !== undefined
      ? value
      : field.default
  }
  return out
}

/** Which session's bar is being asked about: a folder and a branch, resolved in main. */
export interface PluginTarget {
  /** Absolute working directory, resolved in the main process. */
  cwd: string
  /** Current branch, or null on a detached HEAD or outside a repository. */
  branch: string | null
}

/** What a plugin is told about the session whose bar it is contributing to. */
export interface PluginContext extends PluginTarget {
  /**
   * The folder's `origin` remote URL, or null when there is none. Asked of the context
   * rather than shelled out for by each plugin, so two plugins evaluating one folder spawn
   * `git remote get-url` once: the registry memoises it for the length of one evaluation.
   */
  remoteUrl(): Promise<string | null>
}

export interface SessionBarPlugin {
  id: string
  /** Shown in Settings, where the plugin is switched on and off. */
  name: string
  /** A sentence under the name saying what the plugin does. */
  description?: string
  /** Whether a plugin nobody has configured starts on. Read once, at registration —
   *  `BuiltinPluginConfig.enabled` still wins when the user has actually set it. Defaults to `true`. */
  defaultEnabled?: boolean
  /** The settings this plugin declares; Settings draws them, and they come back to `evaluate`. */
  settings?: PluginSettingField[]
  /**
   * What to put on the bar, or null for nothing at all.
   *
   * May be slow (this one shells out to `glab`, which goes to the network), so the registry caches
   * and never blocks the bar on it. Throwing is allowed and contained: see the registry.
   *
   * Returns everything but `pluginId`: the registry stamps that itself from `id` above, so an item
   * cannot disagree with the plugin that produced it.
   */
  evaluate(
    ctx: PluginContext, settings: PluginSettingValues,
  ): Promise<Omit<PluginBarItem, 'pluginId'> | null>
  /** Released when the app quits, or the plugin is otherwise torn down — for a plugin that ever
   *  holds a timer, a socket or a subscription of its own. */
  dispose?(): void
}
