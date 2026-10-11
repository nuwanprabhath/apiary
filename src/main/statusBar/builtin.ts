import { createClaudeUsagePlugin, type ClaudeUsageDeps } from './claudeUsage/plugin'
import { createRemoteClientsPlugin, type RemoteClientsFeed } from './remoteClients'
import type { StatusBarPlugin } from './types'

/** What the built-in status-bar plugins are built from. */
export type BuiltinStatusBarDeps = ClaudeUsageDeps & { remoteClients: RemoteClientsFeed | undefined }

/** Every status-bar plugin Apiary ships with, in the order the bar shows them. */
export const BUILTIN_STATUS_BAR_PLUGINS: ((deps: BuiltinStatusBarDeps) => StatusBarPlugin)[] = [
  createClaudeUsagePlugin,
  (deps) => createRemoteClientsPlugin(deps.remoteClients),
]
