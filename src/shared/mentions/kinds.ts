import type { RepoWebLocation } from './repoWebLocation'

/** What a message's text is read against: the session's repository, and whether files can be opened. */
export interface MentionContext {
  repo: RepoWebLocation | null
  /** A file name is a mention only where a click can open it (VS Code is available). */
  files: boolean
}

/** A link opens in the browser; a file opens through main, which finds it from the session. */
export type MentionTarget = { kind: 'link'; href: string } | { kind: 'file'; text: string }

/**
 * One kind of thing a message mentions. `pattern` is global and is matched against the text of
 * prose only (never a code block, inline code or a link); `resolve` turns a match into a target,
 * or null when this context has none (a `!12` in a GitHub repository).
 */
export interface MentionKind {
  pattern: RegExp
  resolve: (match: RegExpExecArray, context: MentionContext) => MentionTarget | null
}

// Extensions that make a word a file name. A curated list, not "anything.anything": otherwise
// `example.com` and `e.g` would be offered as files.
const EXTENSIONS = [
  'md', 'mdx', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl', 'yml', 'yaml', 'toml', 'css', 'scss',
  'html', 'xml', 'svg', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'sql',
  'csv', 'lock', 'log', 'env', 'ini', 'cfg', 'conf', 'gradle', 'php', 'vue', 'svelte',
].join('|')
const PATH = String.raw`(?:\.{1,2}/)?[\w@.\-]+(?:/[\w@.\-]+)*\.(?:${EXTENSIONS})(?::\d{1,7}(?::\d{1,7})?)?`
/** A whole inline-code span or link text that is only a file name. */
export const WHOLE_FILE_NAME = new RegExp(`^${PATH}$`, 'i')

// A reference is not glued to a word, a path, a URL's query or another reference.
const REF_BEFORE = String.raw`(?<![\w/.\-:@&=?#!])`
const REF_AFTER = String.raw`(?![\w-]|\.\w)`
const PROJECT = String.raw`([\w.-]+(?:/[\w.-]+)+)`
const CSS_PROPERTY_BEFORE = /[\w-]+:\s*$/

function link(href: string): MentionTarget {
  return { kind: 'link', href }
}

function forgeOrigin(repo: RepoWebLocation): string {
  return new URL(repo.webUrl).origin
}

function onForge(context: MentionContext, forge: RepoWebLocation['forge']): RepoWebLocation | null {
  return context.repo?.forge === forge ? context.repo : null
}

/** `#123456` after `color: ` is a colour, not issue 123456. */
function looksLikeColour(m: RegExpExecArray): boolean {
  return (m[1] ?? '').length === 6 && CSS_PROPERTY_BEFORE.test(m.input.slice(0, m.index))
}

const bareIssue = new RegExp(`${REF_BEFORE}#(\\d+)${REF_AFTER}`, 'g')
const bareMr = new RegExp(`${REF_BEFORE}!(\\d+)${REF_AFTER}`, 'g')
const projectIssue = new RegExp(`${REF_BEFORE}${PROJECT}#(\\d+)${REF_AFTER}`, 'g')
const projectMr = new RegExp(`${REF_BEFORE}${PROJECT}!(\\d+)${REF_AFTER}`, 'g')

/** The built-in kinds; each needs its entry in `MENTION_KINDS`. */
type MentionKindId =
  | 'gitlab-mr' | 'gitlab-issue' | 'github-ref' | 'gitlab-project-mr' | 'gitlab-project-issue' | 'github-repo-ref' | 'file'

const MENTION_KINDS: Record<MentionKindId, MentionKind> = {
  'gitlab-mr': {
    pattern: bareMr,
    resolve: (m, c) => { const r = onForge(c, 'gitlab'); return r === null ? null : link(`${r.webUrl}/-/merge_requests/${m[1]}`) },
  },
  'gitlab-issue': {
    pattern: bareIssue,
    resolve: (m, c) => {
      const r = onForge(c, 'gitlab')
      return r === null || looksLikeColour(m) ? null : link(`${r.webUrl}/-/issues/${m[1]}`)
    },
  },
  // GitHub sends `/issues/N` on to the pull request when N is one.
  'github-ref': {
    pattern: bareIssue,
    resolve: (m, c) => {
      const r = onForge(c, 'github')
      return r === null || looksLikeColour(m) ? null : link(`${r.webUrl}/issues/${m[1]}`)
    },
  },
  'gitlab-project-mr': {
    pattern: projectMr,
    resolve: (m, c) => { const r = onForge(c, 'gitlab'); return r === null ? null : link(`${forgeOrigin(r)}/${m[1]}/-/merge_requests/${m[2]}`) },
  },
  'gitlab-project-issue': {
    pattern: projectIssue,
    resolve: (m, c) => { const r = onForge(c, 'gitlab'); return r === null ? null : link(`${forgeOrigin(r)}/${m[1]}/-/issues/${m[2]}`) },
  },
  'github-repo-ref': {
    pattern: projectIssue,
    resolve: (m, c) => {
      const r = onForge(c, 'github')
      // GitHub names a repository `owner/repo`, never deeper.
      return r === null || (m[1] ?? '').split('/').length !== 2 ? null : link(`${forgeOrigin(r)}/${m[1]}/issues/${m[2]}`)
    },
  },
  // In prose a file name is not part of a longer word, a URL or another path.
  file: {
    pattern: new RegExp(String.raw`(?<![\w/.\-@:])${PATH}(?![\w-]|\.\w)`, 'gi'),
    resolve: (m, c) => (c.files ? { kind: 'file', text: m[0] } : null),
  },
}

/** A mention found in a piece of prose: where it is, and what it points at. */
export interface Mention {
  kind: string
  index: number
  text: string
  target: MentionTarget
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi

/**
 * Every mention in `text`, in order and never overlapping: where two kinds match the same place,
 * the longer match wins (`group/project#12` over `#12`), and nothing inside a URL is a mention.
 * `extra` kinds (a user's own, one day) are read after the built-in ones.
 */
export function findMentions(text: string, context: MentionContext, extra: Readonly<Record<string, MentionKind>> = {}): Mention[] {
  const urls = [...text.matchAll(URL_IN_TEXT)].map((m) => [m.index, m.index + m[0].length] as const)
  const inUrl = (from: number, to: number): boolean => urls.some(([s, e]) => from < e && to > s)
  const found: Mention[] = []
  for (const [id, kind] of Object.entries({ ...MENTION_KINDS, ...extra })) {
    for (const m of text.matchAll(kind.pattern)) {
      if (inUrl(m.index, m.index + m[0].length)) continue
      const target = kind.resolve(m, context)
      if (target !== null) found.push({ kind: id, index: m.index, text: m[0], target })
    }
  }
  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length)
  const kept: Mention[] = []
  let end = 0
  for (const m of found) {
    if (m.index < end) continue
    kept.push(m)
    end = m.index + m.text.length
  }
  return kept
}
