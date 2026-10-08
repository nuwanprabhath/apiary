import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

/**
 * The real path of `path` when it lies inside `root`, else null. The one way main confines a path
 * to a directory.
 *
 * Both sides go through `realpath`, because a lexical check (`resolve` then `startsWith`) only
 * proves where a path is *written*: a symlink inside the root that points outside it passes that
 * check and reads whatever it points at. A root reached through a symlink (macOS's `/var`) needs
 * the same treatment, or every path under it would look like it escaped. A path that does not
 * exist has no real path and is refused; use the returned path for the read that follows, not the
 * one that was passed in.
 */
export async function realPathInside(root: string, path: string): Promise<string | null> {
  let realRoot: string
  let real: string
  try {
    ;[realRoot, real] = await Promise.all([realpath(root), realpath(path)])
  } catch {
    return null
  }
  const rel = relative(realRoot, real)
  const escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return escapes ? null : real
}
