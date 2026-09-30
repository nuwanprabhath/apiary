import { createClaudeUsagePlugin, type ClaudeUsageDeps } from './claudeUsage/plugin'
import type { StatusBarPlugin } from './types'

/** Every status-bar plugin Apiary ships with, in the order the bar shows them. */
export const BUILTIN_STATUS_BAR_PLUGINS: ((deps: ClaudeUsageDeps) => StatusBarPlugin)[] = [
  createClaudeUsagePlugin,
]
