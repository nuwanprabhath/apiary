/** Which forge hosts a repository: it decides how a `#12` or `!34` in a message becomes a URL. */
export type Forge = 'gitlab' | 'github'

/** A repository's page on its forge, worked out from its `origin` remote by main. */
export interface RepoWebLocation {
  forge: Forge
  /** `https://host/group/project`, no trailing slash, no `.git`. */
  webUrl: string
}

const SCP_REMOTE = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/
const PATH_SEGMENT = /^[\w.-]+$/
/** github.com or one of its subdomains. */
export const GITHUB_HOST = /(^|\.)github\.com$/i

function forgeOf(host: string, segments: number): Forge | null {
  if (GITHUB_HOST.test(host)) return 'github'
  if (/gitlab/i.test(host)) return 'gitlab'
  // Only GitLab nests projects in subgroups (`group/sub/project`).
  return segments > 2 ? 'gitlab' : null
}

function locationOf(host: string, rawPath: string): RepoWebLocation | null {
  const path = rawPath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
  const segments = path.split('/')
  if (host === '' || segments.length < 2 || !segments.every((s) => PATH_SEGMENT.test(s))) return null
  const forge = forgeOf(host, segments.length)
  return forge === null ? null : { forge, webUrl: `https://${host.toLowerCase()}/${path}` }
}

/**
 * The web page of the repository a git remote URL points at: `git@host:group/project(.git)`,
 * `https://host/group/project(.git)` or `ssh://git@host[:port]/group/project`. Null for a local
 * path, a host that is not recognisably GitHub or GitLab, or anything else.
 */
export function parseRepoWebLocation(remote: string): RepoWebLocation | null {
  const text = remote.trim()
  if (text === '' || text.startsWith('/') || text.startsWith('.')) return null
  const scp = SCP_REMOTE.exec(text)
  if (scp !== null && !text.includes('://')) return locationOf(scp[1] ?? '', scp[2] ?? '')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null // not a URL and not scp-like: no web page to point at
  }
  if (!['ssh:', 'http:', 'https:', 'git:'].includes(url.protocol)) return null
  // The port is how git reaches the host over ssh, not where its web pages are.
  return locationOf(url.hostname, url.pathname)
}
