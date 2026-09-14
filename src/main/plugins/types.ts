/**
 * Session bar plugins.
 *
 * The bar under a session (shell toggle, branch, pull/push) is where things that are *about the
 * checkout in front of you* belong. A merge-request button is the first of those that Apiary
 * itself has no business knowing about — it is GitLab's idea, not Apiary's — and it will not be
 * the last. So the bar takes contributions instead of growing another hardcoded button.
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

/** What a plugin is told about the session whose bar it is contributing to. */
export interface PluginContext {
  /** Absolute working directory, resolved in the main process. */
  cwd: string
  /** Current branch, or null on a detached HEAD or outside a repository. */
  branch: string | null
}

/** The icons the renderer can draw for a plugin. Adding one means adding it in both places. */
export type PluginIcon = 'merge-request' | 'link' | 'plus' | 'alert'

/** What clicking a plugin's button does. */
export type PluginAction =
  /** Opens a URL in the user's browser. Only http(s) is ever opened. */
  | { kind: 'open-url'; url: string }
  /** Does nothing — for a button that is only reporting a state. */
  | { kind: 'none' }

export interface PluginBarItem {
  /** Which plugin produced this, so ids cannot collide across plugins. */
  pluginId: string
  /** Unique within the plugin. */
  id: string
  icon: PluginIcon
  /** Short text beside the icon — `!1255`, `New MR`. The bar is narrow; keep it to a few chars. */
  label: string
  /** The tooltip, which is where the sentence goes. */
  title: string
  action: PluginAction
  /**
   * Colours the button: `normal` for a thing that exists, `suggest` for an offer (no MR yet),
   * `problem` for something that needs attention before the button can work.
   */
  tone?: 'normal' | 'suggest' | 'problem'
}

export interface SessionBarPlugin {
  id: string
  /** Shown in Settings, where the plugin is switched on and off. */
  name: string
  /**
   * What to put on the bar, or null for nothing at all.
   *
   * May be slow (this one shells out to `glab`, which goes to the network), so the registry caches
   * and never blocks the bar on it. Throwing is allowed and contained: see the registry.
   */
  evaluate(ctx: PluginContext): Promise<PluginBarItem | null>
}
