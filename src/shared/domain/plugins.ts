/**
 * Session-bar plugin types, canonical here rather than mirrored between `main/plugins/types.ts`
 * and a renderer-facing copy. See CLAUDE.md "Session-bar plugins": a plugin's contribution is always data, never markup.
 */

/** A plugin's settings, as stored and as handed back to it. */
export type PluginSettingValues = Record<string, string | number | boolean>

/**
 * A setting a plugin declares, which the Plugins section of Settings draws. Plugins describe
 * rather than draw: one that could render into the settings dialog could render anything.
 */
export type PluginSettingField =
  | { kind: 'string'; key: string; label: string; help?: string; placeholder?: string; default: string }
  | { kind: 'boolean'; key: string; label: string; help?: string; default: boolean }
  | { kind: 'number'; key: string; label: string; help?: string; default: number; min?: number; max?: number }

/** The icons the renderer can draw for a plugin. Adding one means adding it in both places. */
export type PluginIcon =
  | 'merge-request'
  | 'merge-request-merged'
  | 'merge-request-closed'
  | 'link'
  | 'plus'
  | 'alert'

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
  /** The tooltip. */
  title: string
  action: PluginAction
  /**
   * Colours the button: `normal` for a thing that exists, `suggest` for an offer (no MR yet),
   * `problem` for something that needs attention before the button can work.
   */
  tone?: 'normal' | 'suggest' | 'problem'
}

export interface PluginInfoPayload {
  id: string
  name: string
  description: string | null
  enabled: boolean
  fields: PluginSettingField[]
  values: PluginSettingValues
}
