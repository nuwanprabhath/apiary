import { createGitLabMrPlugin, type GitLabMrOptions } from './gitlabMr'
import type { SessionBarPlugin } from './types'

/**
 * Every session-bar plugin Apiary ships with (MAIN-17). Registering a new one is one factory added
 * here, plus a line in `PluginService`'s constructor to pass it whatever it needs from
 * `BuiltinPluginConfig` — not a change to the registration logic, which just iterates this array. `defaultEnabled` and the plugin's own `id` decide whether it starts on and
 * what its bar items are stamped with, so nothing here is plugin-specific beyond the list itself.
 */
export const BUILTIN_PLUGINS: ((deps: GitLabMrOptions) => SessionBarPlugin)[] = [
  createGitLabMrPlugin,
]
