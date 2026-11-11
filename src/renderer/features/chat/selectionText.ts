/** What makes a selection more than running text: a list, paragraph, code block, heading or the like. */
const STRUCTURE = 'p, pre, ul, ol, li, blockquote, h1, h2, h3, h4, h5, h6, table, hr'

/** True when `fragment` holds block structure, so its text needs more than `Selection.toString()`. */
export function hasStructure(fragment: ParentNode): boolean {
  return fragment.querySelector(STRUCTURE) !== null
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element)) return ''
  if (node.tagName === 'BR') return '\n'
  return [...node.childNodes].map(inline).join('')
}

function isBlock(el: Element): boolean {
  return el.matches(STRUCTURE)
}

function indented(text: string, pad: string): string {
  return text.split('\n').map((line) => (line === '' ? line : pad + line)).join('\n')
}

function listText(list: Element): string {
  const ordered = list.tagName === 'OL'
  let n = Number.parseInt(list.getAttribute('start') ?? '', 10)
  if (Number.isNaN(n)) n = 1
  const pad = ordered ? '   ' : '  '
  const items: string[] = []
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue
    const marker = ordered ? `${String(n)}. ` : '- '
    n += 1
    const parts = blocks(li)
    items.push(parts.map((part, i) => (i === 0 ? marker + part.replaceAll('\n', `\n${pad}`) : indented(part, pad))).join('\n'))
  }
  return items.join('\n')
}

function blockText(el: Element): string {
  if (el.tagName === 'UL' || el.tagName === 'OL') return listText(el)
  if (el.tagName === 'PRE') return (el.textContent ?? '').replace(/\n$/, '')
  if (el.tagName === 'HR') return '---'
  if (el.tagName === 'BLOCKQUOTE') return indented(blocks(el).join('\n\n'), '> ')
  if (el.tagName === 'TABLE') {
    return [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => (c.textContent ?? '').trim()).join(' | ')).join('\n')
  }
  return inline(el).trim()
}

/** The blocks under `parent`: each block element on its own, and the loose text between them as one. */
function blocks(parent: Element): string[] {
  const out: string[] = []
  let run = ''
  const flush = (): void => {
    if (run.trim() !== '') out.push(run.trim())
    run = ''
  }
  for (const child of parent.childNodes) {
    if (child instanceof Element && isBlock(child)) {
      flush()
      out.push(blockText(child))
    } else run += inline(child)
  }
  flush()
  return out
}

/**
 * The text of a selection's HTML as Markdown-ish plain text: `1. ` and `- ` for list items (an `ol`
 * keeps its `start`), nested lists indented 3 (ol) or 2 (ul) spaces, a blank line between blocks,
 * code blocks as they are, headings and inline code as their text.
 */
export function selectionText(fragment: Element): string {
  return blocks(fragment).join('\n\n')
}
