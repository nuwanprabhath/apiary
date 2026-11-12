import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { realPathInside } from '../fs/confine'

const hasControlChar = (text: string): boolean => [...text].some((c) => c.charCodeAt(0) < 0x20)

const MAX_MENTION_LENGTH = 1024
// `src/a.ts:42` and `src/a.ts:42:7`: a line (and column) VS Code can go to.
const LINE_SUFFIX = /:(\d{1,7})(?::(\d{1,7}))?$/
// A linked worktree's `.git` is a file naming its folder inside the main checkout's `.git`.
const WORKTREE_GITDIR = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\n]+\s*$/m

export interface MentionedFile {
  /** The file's real path, inside one of the places a mention may name. */
  file: string
  line: number | null
}

/** Where a mention may point: the session's folder (and, for a worktree, its main checkout), and
 *  for a path written in full or from `~/`, anywhere in the home folder. */
export interface MentionPlaces {
  folder: string
  home: string
}

export type MentionLookup =
  | { found: MentionedFile }
  /** `missing`: nothing is there (an agent often names a file before it writes it); `outside`: a
   *  file is there, but not in a place a mention may name; `invalid`: the text is not a path. */
  | { refused: 'missing' | 'outside' | 'invalid' }

/** The main checkout a linked worktree belongs to, or null for a main checkout or no repository.
 *  Gitignored files (a local token, an `.env`) exist only there, so an agent working in the
 *  worktree still names them by their path in the repository. */
async function mainCheckoutOf(folder: string): Promise<string | null> {
  const text = await ignoreErrorsAsync(() => readFile(join(folder, '.git'), 'utf8'), 'a folder that is no linked worktree has no .git file')
  const match = text === undefined ? null : WORKTREE_GITDIR.exec(text)
  return match === null ? null : resolve(folder, match[1]!)
}

async function fileInside(root: string, path: string): Promise<string | null> {
  const real = await realPathInside(root, path)
  if (real === null) return null
  const info = await ignoreErrorsAsync(() => stat(real), 'a file that just vanished is simply refused')
  return info?.isFile() === true ? real : null
}

/**
 * The file a transcript's text means. `mention` is text as written in a message, so it is
 * untrusted: a relative path is looked for in the session's folder, then in its repository's main
 * checkout; a path written in full (or from `~/`) only inside the home folder. Each candidate must
 * still be inside its place by real path (a `../` or a symlink out is refused) and be a regular file.
 */
export async function findMentionedFile(places: MentionPlaces, mention: string): Promise<MentionLookup> {
  const text = mention.trim()
  if (text === '' || text.length > MAX_MENTION_LENGTH || hasControlChar(text)) return { refused: 'invalid' }
  const at = LINE_SUFFIX.exec(text)
  const line = at === null ? null : Number(at[1])
  const bare = at === null ? text : text.slice(0, at.index)
  const written = bare.startsWith('~/') ? join(places.home, bare.slice(2)) : bare
  const candidates: Array<{ root: string; path: string }> = []
  if (isAbsolute(written)) {
    candidates.push({ root: places.folder, path: written }, { root: places.home, path: written })
  } else {
    candidates.push({ root: places.folder, path: resolve(places.folder, written) })
    const main = await mainCheckoutOf(places.folder)
    if (main !== null) candidates.push({ root: main, path: resolve(main, written) })
  }
  for (const { root, path } of candidates) {
    const file = await fileInside(root, path)
    if (file !== null) return { found: { file, line } }
  }
  const exists = await Promise.all(candidates.map(({ path }) => ignoreErrorsAsync(() => stat(path), 'nothing there is the answer')))
  return { refused: exists.some((s) => s?.isFile() === true) ? 'outside' : 'missing' }
}

