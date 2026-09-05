import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
  /** Explicit path to the claude binary, used when it is not on PATH. */
  claudeBin: string | null
  windowBounds: WindowBounds | null
}

export const DEFAULT_SETTINGS: AppSettings = { claudeBin: null, windowBounds: null }

export function loadSettings(file: string): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    // Missing or corrupt settings must never stop the app from starting.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(file: string, settings: AppSettings): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(settings, null, 2))
  } catch {
    // A read-only home directory should not crash the app.
  }
}
