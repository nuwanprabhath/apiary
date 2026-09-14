/**
 * Working out which GitLab project a checkout belongs to, from its git remote.
 *
 * Needed for the half of the merge-request button that does not involve GitLab's API at all: when
 * there is no MR yet, the button opens GitLab's own "new merge request" page with the source
 * branch already filled in. That URL can be built from the remote alone, so offering to create an
 * MR keeps working even where looking one up does not — no `glab`, no token, no network.
 */

export interface GitLabRemote {
  /** `https://gitlab.com` or a self-hosted origin. */
  host: string
  /** `group/subgroup/project`, without the `.git`. */
  project: string
  /** The project's page. */
  webUrl: string
}

/**
 * Parses a git remote URL into a GitLab project.
 *
 * Handles the three forms a GitLab remote takes in practice: `git@host:group/project.git`,
 * `ssh://git@host[:port]/group/project.git`, and `https://host/group/project.git`. Subgroups are
 * ordinary path segments, so `group/sub/project` needs no special handling — but a self-hosted
 * instance served from a subdirectory would, and is not supported rather than guessed at.
 *
 * Returns null for anything that is not recognisably a remote, including GitHub: this is the
 * GitLab plugin, and a GitHub checkout should get no button rather than a broken one.
 */
export function parseGitLabRemote(remote: string): GitLabRemote | null {
  const trimmed = remote.trim()
  if (trimmed === '') return null

  // scp-like: git@host:group/project.git — not a URL, so it is matched before anything else tries.
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+?)(?:\.git)?$/.exec(trimmed)
  if (scp !== null) return build(scp[1], scp[2])

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!['ssh:', 'http:', 'https:', 'git:'].includes(url.protocol)) return null
  const project = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
  // `url.host` carries the port, which belongs to how you reach git over ssh, not to the web UI.
  return build(url.hostname, project)
}

function build(hostname: string, rawProject: string): GitLabRemote | null {
  const project = rawProject.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (hostname === '' || project === '' || !project.includes('/')) return null
  // GitHub is not this plugin's business, and a GitLab URL built from a GitHub remote would 404.
  if (/(^|\.)github\.com$/i.test(hostname)) return null
  const host = `https://${hostname}`
  return { host, project, webUrl: `${host}/${project}` }
}

/**
 * GitLab's "new merge request" page for a branch.
 *
 * The query parameter is the one GitLab's own UI uses when you click "Create merge request" on a
 * branch, so the form opens with the source branch chosen and the rest left to the user — which is
 * the point: creating an MR involves a title, a description and reviewers, and a button in a
 * terminal app has no business inventing those.
 */
export function newMergeRequestUrl(remote: GitLabRemote, branch: string): string {
  const source = encodeURIComponent(branch)
  return `${remote.webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${source}`
}
