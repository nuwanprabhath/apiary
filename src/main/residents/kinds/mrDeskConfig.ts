import { shellQuote } from '../../exec/shellQuote'
import { parseGitlabProject } from './mrDeskProject'

/** A trimmed option of the resident, '' when unset. */
export const optionOf = (options: Readonly<Record<string, string>>, key: string): string =>
  Object.hasOwn(options, key) ? options[key].trim() : ''

/**
 * The `config.json` mra reads, from the resident's options. `active_hours` is null because
 * Apiary's schedule decides when a cycle runs; everything else is mra's own default
 * (`mra/config.py` merges them in). `username` is left out when empty so mra asks `glab`. A
 * project given as a URL becomes its path plus `gitlab_host`; the setting itself is left as typed.
 */
export function mraConfigFor(options: Readonly<Record<string, string>>): Record<string, unknown> {
  const username = optionOf(options, 'username')
  const parsed = parseGitlabProject(optionOf(options, 'project'))
  return {
    project: parsed?.project ?? optionOf(options, 'project'),
    ...(parsed === null || parsed.host === null ? {} : { gitlab_host: parsed.host }),
    repo_path: optionOf(options, 'repoPath'),
    ...(username === '' ? {} : { username }),
    active_hours: null,
  }
}

/** The `<space>/bin/mra` script: the skill's `mra …` commands run as written in the resident's shell. */
export function mraWrapper(script: string): string {
  return `#!/bin/sh\nexec python3 ${shellQuote(script)} "$@"\n`
}

/** Whether the options name a project and a clone, which `mra` refuses to start without. */
export function mraConfigured(options: Readonly<Record<string, string>>): boolean {
  return optionOf(options, 'project') !== '' && optionOf(options, 'repoPath') !== ''
}
