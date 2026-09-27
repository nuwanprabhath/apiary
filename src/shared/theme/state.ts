import type { ThemeSpec } from './spec'
import type { ThemeModel } from './models'

/**
 * The wire shapes for a theme as a whole — as opposed to `spec.ts`'s allowlists for what one may
 * contain. Moved out of `api.ts` (SHARED-1 / SHARED-8) so theme state lives beside the rest of the
 * theme feature instead of in the general IPC grab-bag.
 */

/** A theme the user saved (see main/theme/themeStore.ts). Its spec has been validated. */
export interface SavedTheme {
  id: string
  name: string
  /** What it was generated from, when it was generated; null for a copy of another theme. */
  prompt: string | null
  createdAt: number
  spec: ThemeSpec
}

export interface ThemeOptions {
  /** Whether effects move. Off draws a still frame — as does the OS asking for reduced motion. */
  animated: boolean
  /** A multiplier on every effect's intensity, 0–1. */
  intensity: number
  /** Which Claude model designs themes. */
  model: ThemeModel
}

/** A theme Claude designed, validated in main; `note` says what validation changed, if anything. */
export interface ThemeGenerateResult {
  spec: ThemeSpec
  note: string | null
}

/** Everything the Themes screen and every window's styling need, pushed on every change. */
export interface ThemeState {
  /** A saved theme's id, a `builtin:*` id, or null for Apiary's own look. */
  activeId: string | null
  /** What to apply: the active theme's spec — or null for the original look, including in safe mode. */
  active: ThemeSpec | null
  saved: SavedTheme[]
  builtins: Array<{ id: string; spec: ThemeSpec }>
  options: ThemeOptions
  /** Started with `--safe-theme`: the original look for this run, whatever is saved. */
  safeMode: boolean
}
