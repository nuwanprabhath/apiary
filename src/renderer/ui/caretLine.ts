const COPIED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'wordSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
] as const

/** Top offset of the caret's visual line and of the text's first and last visual lines, measured
 *  in a hidden copy of the textarea (same width, font and wrapping). */
function lineTops(box: HTMLTextAreaElement): { caret: number; first: number; last: number } {
  const style = getComputedStyle(box)
  const mirror = document.createElement('div')
  for (const key of COPIED) mirror.style[key] = style[key]
  // The width the text wraps in: `clientWidth` leaves out a scrollbar a long message has
  // (Linux draws a classic one), which the box's own `width` would count as room for text.
  mirror.style.boxSizing = 'border-box'
  mirror.style.width = `${box.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden', height: 'auto',
  })
  const marker = (text = ''): HTMLSpanElement => {
    const span = document.createElement('span')
    span.textContent = text
    return span
  }
  // The markers are empty: a zero-width space would be a break opportunity of its own, and a caret
  // inside a word at the edge of a line would then wrap the copy differently from the box.
  const before = marker(box.value.slice(0, box.selectionStart))
  const caret = marker()
  const after = marker(box.value.slice(box.selectionStart))
  const end = marker()
  const start = marker()
  mirror.append(start, before, caret, after, end)
  document.body.append(mirror)
  try {
    const top = (el: HTMLElement): number => el.getBoundingClientRect().top
    return { caret: top(caret), first: top(start), last: top(end) }
  } finally {
    mirror.remove()
  }
}

/** The caret is on the textarea's first visual line (a wrapped line counts as several). */
export function caretOnFirstLine(box: HTMLTextAreaElement): boolean {
  if (box.value.slice(0, box.selectionStart).includes('\n')) return false
  const { caret, first } = lineTops(box)
  return Math.abs(caret - first) < 1
}

/** The caret is on the textarea's last visual line. */
export function caretOnLastLine(box: HTMLTextAreaElement): boolean {
  if (box.value.slice(box.selectionEnd).includes('\n')) return false
  const { caret, last } = lineTops(box)
  return Math.abs(caret - last) < 1
}
