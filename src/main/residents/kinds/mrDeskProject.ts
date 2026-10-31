/** The GitLab project mra reads: its path, and the host when the user gave a URL to one. */
export interface GitlabProject {
  project: string
  host: string | null
}

const PROJECT_PATH_RE = /^[\w.-]+(?:\/[\w.-]+)+$/

/**
 * The `project` option as mra wants it. A URL (`https://gitlab.example.com/group/sub/project`,
 * with or without `.git`, a trailing slash or a `/-/…` page) gives its path and host; a plain
 * `group/project` passes through. Null when it is neither.
 */
export function parseGitlabProject(value: string): GitlabProject | null {
  const text = value.trim()
  if (PROJECT_PATH_RE.test(text)) return { project: text.replace(/\.git$/, ''), host: null }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null // neither a path nor a URL: setup says what it should look like
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname.split('/-/')[0].replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+/, '')
  return PROJECT_PATH_RE.test(path) ? { project: path, host: url.host } : null
}
