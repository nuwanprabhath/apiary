/**
 * A `!<digits>` reference found in a session's title or note, e.g. `!1267` in "fixes !1267".
 *
 * Deliberately blind to a URL's own path: a merge-request URL never contains `!<digits>`, so the
 * only real collision is a query string someone pasted (`?x=!123`), which is excluded by scanning
 * past every URL match before looking for references at all.
 */
export interface MrRef {
  iid: number
  /** Character offset of the `!` in `text`, for splitting the string around it when rendering. */
  index: number
}

const URL_PATTERN = /https?:\/\/\S+/g
const REF_PATTERN = /!(\d+)/g

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch)
}

/** Finds every `!<digits>` reference in `text`, skipping ones glued to a word and ones inside a URL. */
export function parseMrRefs(text: string): MrRef[] {
  const urlRanges: Array<[number, number]> = []
  for (const m of text.matchAll(URL_PATTERN)) {
    urlRanges.push([m.index, m.index + m[0].length])
  }
  const withinUrl = (i: number): boolean => urlRanges.some(([start, end]) => i >= start && i < end)

  const refs: MrRef[] = []
  for (const m of text.matchAll(REF_PATTERN)) {
    const index = m.index
    if (withinUrl(index)) continue
    if (isWordChar(text[index - 1])) continue
    if (isWordChar(text[index + m[0].length])) continue
    refs.push({ iid: Number(m[1]), index })
  }
  return refs
}
