import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { realPathInside } from '../fs/confine'

const hasControlChar = (text: string): boolean => [...text].some((c) => c.charCodeAt(0) < 0x20)

const MAX_MENTION_LENGTH = 1024
// `src/a.ts:42` and `src/a.ts:42:7`: a line (and column) VS Code can go to.
const LINE_SUFFIX = /:(\d{1,7})(?::(\d{1,7}))?$/

export interface MentionedFile {
  /** The file's real path, inside the session's folder. */
  file: string
  line: number | null
}

/**
 * The file a transcript's text means, or null. `mention` is text as written in a message, so it is
 * untrusted: it is resolved against the session's own folder, must still be inside it by real path
 * (a `../` or a symlink out is refused), and must be an existing regular file.
 */
export async function resolveMentionedFile(cwd: string, mention: string): Promise<MentionedFile | null> {
  const text = mention.trim()
  if (text === '' || text.length > MAX_MENTION_LENGTH || hasControlChar(text)) return null
  const at = LINE_SUFFIX.exec(text)
  const bare = at === null ? text : text.slice(0, at.index)
  const real = await realPathInside(cwd, resolve(cwd, bare))
  if (real === null) return null
  const info = await ignoreErrorsAsync(() => stat(real), 'a file that just vanished is simply refused')
  if (info?.isFile() !== true) return null
  return { file: real, line: at === null ? null : Number(at[1]) }
}
