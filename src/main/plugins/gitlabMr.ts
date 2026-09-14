import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseGitLabRemote, newMergeRequestUrl, type GitLabRemote } from './gitlabRemote'
import type { PluginBarItem, PluginContext, SessionBarPlugin } from './types'

const run = promisify(execFile)

/**
 * The merge-request button, the way the GitLab VS Code extension's works: if the branch you are on
 * has an MR, the button is that MR and clicking opens it; if it does not, the button offers to
 * create one and clicking opens GitLab's own new-MR form with the branch filled in.
 *
 * **Why `glab` rather than GitLab's API directly.** Talking to the API means holding a token, and
 * holding a token means storing a credential, offering a field to paste it into, keeping it out of
 * logs and settings backups, and explaining what scope it needs. `glab` — GitLab's own CLI — has
 * already solved all of that, including for self-hosted instances, and anyone using GitLab from a
 * terminal is likely to have it. So Apiary asks `glab`, and never sees a credential at all.
 *
 * The half that does not need `glab` still works without it: "no MR yet, open the form" is built
 * from the git remote alone, so the button is useful the moment there is a GitLab remote.
 */

export interface GitLabMrOptions {
  /** The `glab` executable. Configurable for anyone whose install is not on PATH. */
  glabPath?: string
  /** Injected in tests. Returns stdout, or throws the way execFile does. */
  exec?: (file: string, args: string[], cwd: string) => Promise<string>
  /** Milliseconds before a lookup is abandoned; a hung CLI must not hold a bar item forever. */
  timeoutMs?: number
}

/** The fields used from `glab mr list --output json`; everything else in the payload is ignored. */
interface GlabMr {
  iid: number
  state: string
  web_url: string
  title: string
  draft?: boolean
  target_branch?: string
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Picks the merge request a branch "has" when GitLab reports several.
 *
 * An open one always wins: a branch with an old merged MR and a new open one is being worked in
 * the open one. Among open MRs the highest iid is the most recent. Closed and merged ones are
 * still worth showing when there is nothing open — the answer to "where did this branch go" is
 * often a merged MR — but they are shown as what they are.
 */
export function pickMergeRequest(list: GlabMr[]): GlabMr | null {
  if (list.length === 0) return null
  const byNewest = [...list].sort((a, b) => b.iid - a.iid)
  return byNewest.find((mr) => mr.state === 'opened') ?? byNewest[0]
}

/** Turns the chosen MR into the button. */
export function itemForMergeRequest(mr: GlabMr): PluginBarItem {
  const state = mr.state === 'opened'
    ? (mr.draft === true ? 'Draft' : 'Open')
    : mr.state.charAt(0).toUpperCase() + mr.state.slice(1)
  return {
    pluginId: 'gitlab-mr',
    id: 'mr',
    icon: 'merge-request',
    // The number is the label because it is what gets quoted in chat, in commits and in standups.
    label: `!${String(mr.iid)}`,
    title: `${state}: ${mr.title}`,
    action: { kind: 'open-url', url: mr.web_url },
    tone: mr.state === 'opened' ? 'normal' : 'suggest',
  }
}

/** The button offering to create one. */
export function itemForNewMergeRequest(remote: GitLabRemote, branch: string): PluginBarItem {
  return {
    pluginId: 'gitlab-mr',
    id: 'mr-new',
    icon: 'plus',
    label: 'MR',
    title: `No merge request for ${branch} — create one on GitLab`,
    action: { kind: 'open-url', url: newMergeRequestUrl(remote, branch) },
    tone: 'suggest',
  }
}

async function defaultExec(file: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(file, args, { cwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

export function createGitLabMrPlugin(options: GitLabMrOptions = {}): SessionBarPlugin {
  const glab = options.glabPath ?? 'glab'
  const exec = options.exec ?? defaultExec

  return {
    id: 'gitlab-mr',
    name: 'GitLab merge request',

    async evaluate(ctx: PluginContext): Promise<PluginBarItem | null> {
      // A detached HEAD has no branch to have an MR for, and nothing sensible to create one from.
      if (ctx.branch === null || ctx.branch === '') return null

      const remoteUrl = await originUrl(ctx.cwd, exec)
      if (remoteUrl === null) return null
      const remote = parseGitLabRemote(remoteUrl)
      if (remote === null) return null

      let list: GlabMr[] = []
      try {
        const stdout = await exec(
          glab,
          ['mr', 'list', '--source-branch', ctx.branch, '--output', 'json'],
          ctx.cwd,
        )
        const parsed: unknown = JSON.parse(stdout.trim() === '' ? '[]' : stdout)
        if (Array.isArray(parsed)) list = parsed as GlabMr[]
      } catch {
        // No glab, not logged in, no network, or a project it cannot see. The half of the button
        // that needs none of those still works, so fall through to offering to create one rather
        // than showing an error for a thing the user may not even want.
        return itemForNewMergeRequest(remote, ctx.branch)
      }

      const mr = pickMergeRequest(list)
      return mr === null ? itemForNewMergeRequest(remote, ctx.branch) : itemForMergeRequest(mr)
    },
  }
}

/** The `origin` remote's URL, or null when there is no remote (or no git). */
async function originUrl(
  cwd: string,
  exec: (file: string, args: string[], cwd: string) => Promise<string>,
): Promise<string | null> {
  try {
    const stdout = await exec('git', ['remote', 'get-url', 'origin'], cwd)
    const url = stdout.trim()
    return url === '' ? null : url
  } catch {
    return null
  }
}
