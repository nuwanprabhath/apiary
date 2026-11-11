/**
 * The selection inside `root` as clean HTML for "Copy with formatting", or '' when there is none.
 *
 * Chromium's own copy carries the theme's colours and fonts inline (white text on a dark chat
 * pastes as invisible text in an email), and a selection that starts inside a list item loses the
 * list around it. So this copies the selected nodes, wraps them again in the formatting elements
 * the selection sits inside (a list, a quote, bold), and keeps only the markup a document needs:
 * no classes, styles, ids or the app's own buttons.
 */
export function selectionHtmlWithin(root: HTMLElement | null): string {
  return selectionFragmentWithin(root)?.innerHTML.trim() ?? ''
}

/** The list item of `list` the range starts in, as its position among the list's items. */
function startIndex(list: Element, range: Range): number {
  let at: Node | null = range.startContainer === list ? (list.childNodes[range.startOffset] ?? null) : range.startContainer
  while (at !== null && at.parentNode !== list) at = at.parentNode
  return at === null ? 0 : [...list.children].filter((c) => c.tagName === 'LI').indexOf(at as Element)
}

/** The cleaned copy of the selection inside `root` (see `selectionHtmlWithin`), or null. */
export function selectionFragmentWithin(root: HTMLElement | null): HTMLElement | null {
  const sel = window.getSelection()
  if (root === null || sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const holder = document.createElement('div')
  holder.append(range.cloneContents())
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  // Up to the rendered message: anything above it is the app's layout, not the text.
  while (node instanceof Element && node !== root && !node.classList.contains('markdown')) {
    if (PASTED_TAGS.has(node.tagName)) {
      const wrapper = node.cloneNode(false) as Element
      // A list the selection starts inside keeps counting from the item it starts at.
      if (node.tagName === 'OL') {
        const first = Number.parseInt(node.getAttribute('start') ?? '', 10)
        wrapper.setAttribute('start', String((Number.isNaN(first) ? 1 : first) + Math.max(0, startIndex(node, range))))
      }
      wrapper.append(...holder.childNodes)
      holder.replaceChildren(wrapper)
    }
    node = node.parentNode
  }
  clean(holder)
  return holder
}

/** The elements markdown produces, which a pasted document keeps. */
const PASTED_TAGS = new Set([
  'P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
])

/** Elements that end a line on their own. */
const BLOCKS = new Set(['P', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'DIV'])

/** Attributes worth keeping on a pasted element: a link's target and a list's numbering. */
const PASTED_ATTRS = new Set(['href', 'start'])

function clean(holder: HTMLElement): void {
  // The app's chrome caught in the selection: code-block Copy buttons, icons, time stamps read aloud only.
  for (const el of holder.querySelectorAll('button, svg, [aria-hidden="true"], input, textarea')) el.remove()
  for (const el of [...holder.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (!PASTED_ATTRS.has(attr.name)) el.removeAttribute(attr.name)
    }
    // A div or span carries layout only: keep what is in it. A div was a line of its own (one
    // message, one row), so it still ends one unless a block inside it already does.
    if (PASTED_TAGS.has(el.tagName)) continue
    const endsLine = el.tagName === 'DIV' && !(el.lastElementChild !== null && BLOCKS.has(el.lastElementChild.tagName))
    el.replaceWith(...el.childNodes, ...(endsLine && (el.textContent ?? '').trim() !== '' ? [document.createElement('br')] : []))
  }
}
