const WORD = /\p{L}\p{M}*(?:['’]?\p{L}\p{M}*)*/gu

export interface WordRange {
  start: number
  end: number
  word: string
}

/** The word the caret is in or touches at either end; digits and hyphens split words. */
export function wordRangeAt(text: string, caret: number): WordRange | null {
  for (const match of text.matchAll(WORD)) {
    const start = match.index
    const end = start + match[0].length
    if (start <= caret && caret <= end) return { start, end, word: match[0] }
  }
  return null
}
