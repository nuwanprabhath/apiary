// Extensions that make a word a file name. A curated list, not "anything.anything": otherwise
// `example.com` and `e.g` would be offered as files.
const EXTENSIONS = [
  'md', 'mdx', 'txt', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl', 'yml', 'yaml', 'toml', 'css', 'scss',
  'html', 'xml', 'svg', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'sql',
  'csv', 'lock', 'log', 'env', 'ini', 'cfg', 'conf', 'gradle', 'php', 'vue', 'svelte',
].join('|')
const PATH = String.raw`(?:\.{1,2}/)?[\w@.\-]+(?:/[\w@.\-]+)*\.(?:${EXTENSIONS})(?::\d{1,7}(?::\d{1,7})?)?`
const WHOLE = new RegExp(`^${PATH}$`, 'i')
// In prose a mention is not part of a longer word, a URL or another path.
const IN_PROSE = new RegExp(String.raw`(?<![\w/.\-@:])${PATH}(?![\w-]|\.\w)`, 'gi')
const MENTION_ATTR = 'data-file-mention'

/** The text of the mention an element carries, if it is one. */
export function mentionOf(el: Element | null): string | null {
  return el?.closest(`[${MENTION_ATTR}]`)?.getAttribute(MENTION_ATTR) ?? null
}

function mark(el: HTMLElement, text: string): void {
  el.setAttribute(MENTION_ATTR, text)
  el.setAttribute('role', 'link')
  el.tabIndex = 0
  el.classList.add('file-mention')
}

function markProse(node: Text): void {
  const text = node.data
  const matches = [...text.matchAll(IN_PROSE)]
  if (matches.length === 0) return
  const parts = document.createDocumentFragment()
  let from = 0
  for (const m of matches) {
    parts.append(text.slice(from, m.index))
    const span = document.createElement('span')
    span.textContent = m[0]
    mark(span, m[0])
    parts.append(span)
    from = m.index + m[0].length
  }
  parts.append(text.slice(from))
  node.replaceWith(parts)
}

/**
 * Marks the file names in already-sanitised markdown HTML as clickable: inline code and links that
 * are only a file name, and file names in running text. Code blocks and real links are left alone.
 * It only adds attributes and wraps text, so nothing it is given can become markup.
 */
export function markFileMentions(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  const texts: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) texts.push(n as Text)
  for (const node of texts) {
    const parent = node.parentElement
    if (parent === null || parent.closest('pre, a[href]') !== null) continue
    const whole = parent.matches('code, a') && parent.childNodes.length === 1
    if (whole) {
      if (WHOLE.test(node.data.trim())) mark(parent, node.data.trim())
    } else if (parent.closest('code') === null) markProse(node)
  }
  return root.innerHTML
}
