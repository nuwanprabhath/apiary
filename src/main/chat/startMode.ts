import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatPermissionMode } from '@shared/domain/chat'

/**
 * The permission mode a chat starts in when the composer has not picked one: Auto, unless Claude
 * Code's own settings choose one (`permissions.defaultMode` in the user's settings, the project's or
 * the project's local ones). Then nothing is passed and claude starts in that one. With neither,
 * claude started in Manual and asked before every tool call.
 */
export function chatStartMode(configRoot: string, cwd: string): ChatPermissionMode | undefined {
  const files = [
    join(configRoot, 'settings.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ]
  return files.some(setsDefaultMode) ? undefined : 'auto'
}

function setsDefaultMode(file: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { permissions?: { defaultMode?: unknown } } | null
    return typeof parsed?.permissions?.defaultMode === 'string'
  } catch {
    // Missing, unreadable or not JSON: claude would not take a mode from it either.
    return false
  }
}
