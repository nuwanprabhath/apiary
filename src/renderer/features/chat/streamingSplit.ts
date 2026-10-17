/** A fence line opens or closes a code block: three or more backticks or tildes at the line start. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** A line that continues a list item or quote over a blank line, so the blank is not a paragraph end. */
const CONTINUES = /^(?: {0,3}(?:[-*+]|\d+[.)])\s|\s{2,}\S|>)/

/**
 * Splits a streamed reply at its last paragraph break that is not inside a code fence, so the part
 * before it is final and only the paragraph being written needs parsing again. A break that sits
 * between list items (or indented continuations) is not a split point: markdown draws those as one
 * list, and cutting it would restart the numbering or break the list in two.
 */
export function splitStreaming(text: string): { done: string; tail: string } {
  let fence: string | null = null
  let split = 0
  let offset = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = FENCE.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
    }
    offset += line.length + 1
    const next = lines[i + 1]
    // `offset` is just past this blank line's newline: the break is the "\n\n" ending here.
    if (fence === null && line === '' && i > 0 && lines[i - 1] !== '' && next !== undefined && !isListBreak(lines, i, next)) {
      split = offset
    }
  }
  return { done: text.slice(0, split), tail: text.slice(split) }
}

/** True when the blank line at `blank` sits inside a list or quote that goes on afterwards. */
function isListBreak(lines: string[], blank: number, next: string): boolean {
  if (!CONTINUES.test(next)) return false
  // Only a list or quote when the paragraph before the blank belongs to one too.
  let before = blank - 1
  while (before > 0 && lines[before - 1] !== '') before--
  return CONTINUES.test(lines[before])
}
