import { createGitLabMrPlugin, type GitLabMrOptions } from './gitlabMr'
import type { SessionBarPlugin } from './types'

/**
 * Every session-bar plugin Apiary ships with. Registering a new one is one factory added
 * here, plus a line in `PluginService`'s constructor to pass it whatever it needs from
 * `BuiltinPluginConfig`; the registration logic just iterates this array.
 */
export const BUILTIN_PLUGINS: ((deps: GitLabMrOptions) => SessionBarPlugin)[] = [
  createGitLabMrPlugin,
]
