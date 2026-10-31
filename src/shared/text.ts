/**
 * Text from outside the app (a Claude reply, an imported file, a typed title) turned into one plain
 * line: every control character (C0 and DEL, which includes newline, tab and ESC) becomes a space,
 * runs of whitespace collapse to one, and the ends are trimmed. The one home for that strip; a
 * caller with a stricter rule (a theme name also loses ANSI sequences first) does that step itself
 * and then calls this.
 */
export function flattenText(text: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are what is being removed
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The last part of a file or folder path, `/` or `\` separated, ignoring a trailing separator; ''
 * for an empty path. What a person recognises a folder by: a full path says where it is on disk,
 * which is mostly noise in a list (and a temp path in a test fixture).
 */
export function lastPathSegment(path: string): string {
  return path.split(/[\\/]/).filter((part) => part !== '').pop() ?? ''
}
