/**
 * How a window's title bar and menus are drawn, decided by main when it opens the window and
 * carried in its URL (`chrome=`) — it decides the layout from the first paint, like the window
 * number does.
 *
 * - `custom` (Windows, Linux): no system title bar. Apiary draws the bar and the menus in the
 *   theme's colours; the OS still draws the window controls, over the bar, in colours Apiary gives
 *   it (`titleBarOverlay`) — what VS Code does with its custom title bar.
 * - `mac`: the menus stay in the system menu bar where every Mac app keeps them; the window's own
 *   title strip, beside the traffic lights, is Apiary's and follows the theme.
 * - `system`: the OS draws everything (Settings → General → "Use the system title bar").
 */
export type WindowChrome = 'custom' | 'mac' | 'system'

/** The application menu as the renderer draws it: data only, read from main's real menu. */
export interface AppMenuNode {
  label: string
  kind: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu'
  /** Display text, already formatted for this platform ("Ctrl+Shift+N"). */
  accelerator?: string
  enabled: boolean
  checked?: boolean
  submenu?: AppMenuNode[]
}

/** "CmdOrCtrl+Shift+N" → "Ctrl+Shift+N" (or "⌘⇧N"-free "Cmd+Shift+N" on a Mac), for display only. */
export function displayAccelerator(accelerator: string, isMac: boolean): string {
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? 'Cmd' : 'Ctrl')
    .replace(/\bPlus\b/g, '+')
}

export function isWindowChrome(v: unknown): v is WindowChrome {
  return v === 'custom' || v === 'mac' || v === 'system'
}

/** `#rrggbb`, the only colour form the title-bar overlay is handed. */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}
