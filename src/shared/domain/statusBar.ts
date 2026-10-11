/**
 * Status-bar plugins: things that contribute an item to the bar along the bottom of the session
 * area, as VS Code extensions contribute to its status bar. Unlike a session-bar plugin, which is
 * asked about one folder and branch, a status-bar item is about the whole app — Claude's usage
 * limits are the first.
 *
 * The same rule as session-bar plugins (src/main/plugins/CLAUDE.md): everything that crosses to
 * the renderer is data. An item's hover detail and its dashboard are lists of typed sections the
 * renderer knows how to draw — tables, gauges, charts, notes — never markup, so a plugin cannot
 * put arbitrary content in the window.
 */

/** Colours an item or a gauge: the plugin says how urgent, the theme says what colour that is. */
export type StatusTone = 'normal' | 'warning' | 'danger'

/** The icons the renderer can draw for a status-bar item. */
export type StatusIcon = 'gauge' | 'refresh' | 'alert' | 'history' | 'link'

/** A chart series colour, from the theme's own palette. */
export type StatusSeriesColor = 'series-1' | 'series-2' | 'series-3' | 'series-4'

export type StatusSection =
  | { kind: 'heading'; text: string }
  | { kind: 'note'; text: string; muted?: boolean }
  /** Columns from `numericFrom` on are right-aligned. A row of all-empty cells is a spacer. */
  | { kind: 'table'; columns: string[]; rows: string[][]; numericFrom?: number; emphasiseLastRow?: boolean }
  | { kind: 'gauges'; gauges: { label: string; percent: number; tone: StatusTone; caption: string }[] }
  /** One stacked column per entry, segments in `series` order. */
  | {
    kind: 'stacked-bars'
    series: { label: string; color: StatusSeriesColor }[]
    columns: { label: string; title: string; values: number[]; totalLabel: string }[]
  }
  | { kind: 'line'; points: { label: string; value: number; title: string }[] }

/**
 * A question a plugin must have answered before it does something the user has not agreed to yet
 * (today: reading Claude Code's sign-in token). The plugin supplies the words, the renderer draws
 * one dialog for any plugin, and the answer goes back through `statusBarConsent`.
 */
export interface ConsentPrompt {
  title: string
  /** One paragraph each: what is read, where it is sent, what is and is not kept. */
  lines: string[]
  allow: string
  deny: string
}

/** What clicking an item does. */
export type StatusAction =
  /** Asks the user's permission first (`ConsentPrompt`); the dialog opens by itself the first time. */
  | { kind: 'consent'; prompt: ConsentPrompt }
  /** Opens the item's dashboard (`statusBarPanel`). */
  | { kind: 'panel' }
  /** Asks the plugin to refresh now. */
  | { kind: 'refresh' }
  /** Opens Settings at `section` (`remote-clients`: General, where "Disconnect all…" is). */
  | { kind: 'settings'; section: string }
  | { kind: 'none' }

export interface StatusBarItem {
  pluginId: string
  /** Unique within the plugin. */
  id: string
  icon?: StatusIcon
  text: string
  /** Accessible name and fallback tooltip. */
  title: string
  tone: StatusTone
  /** Showing the last known value because the latest refresh failed. */
  stale?: boolean
  /** A refresh is in flight (the icon spins). */
  busy?: boolean
  action: StatusAction
  /** What hovering the item shows. Empty: only `title`. */
  detail: StatusSection[]
}

export interface StatusBarPanel {
  title: string
  sections: StatusSection[]
  /** Whether the panel offers a Refresh button (it calls `statusBarRun` with `refresh`). */
  refreshable: boolean
}
