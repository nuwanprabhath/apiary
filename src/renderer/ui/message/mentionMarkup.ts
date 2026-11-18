import { findMentions, WHOLE_FILE_NAME, type MentionContext } from '@shared/mentions/kinds'

const MENTION_ATTR = 'data-file-mention'
const REF_ATTR = 'data-ref-link'

/** The text of the file mention an element carries, if it is one. */
export function mentionOf(el: Element | null): string | null {
  return el?.closest(`[${MENTION_ATTR}]`)?.getAttribute(MENTION_ATTR) ?? null
}

/** The URL of the reference link an element is in, if it is one. */
export function refLinkOf(el: Element | null): string | null {
  return el?.closest(`a[${REF_ATTR}]`)?.getAttribute('href') ?? null
}

function markFile(el: HTMLElement, text: string): void {
  el.setAttribute(MENTION_ATTR, text)
  el.setAttribute('role', 'link')
  el.tabIndex = 0
  el.classList.add('file-mention')
}

function markProse(node: Text, context: MentionContext): void {
  const text = node.data
  const mentions = findMentions(text, context)
  if (mentions.length === 0) return
  const parts = document.createDocumentFragment()
  let from = 0
  for (const m of mentions) {
    parts.append(text.slice(from, m.index))
    if (m.target.kind === 'file') {
      const span = document.createElement('span')
      span.textContent = m.text
      markFile(span, m.target.text)
      parts.append(span)
    } else {
      const a = document.createElement('a')
      a.textContent = m.text
      a.href = m.target.href
      a.title = m.target.href
      a.setAttribute(REF_ATTR, m.kind)
      a.classList.add('ref-link')
      parts.append(a)
    }
    from = m.index + m.text.length
  }
  parts.append(text.slice(from))
  node.replaceWith(parts)
}

/**
 * Marks the mentions in already-sanitised markdown HTML: file names (inline code and links that
 * are only a file name, and file names in running text) and references such as `#12` and `!34`
 * in running text. Code blocks, inline code and real links are left alone. Only text is wrapped,
 * and every href comes from a resolver that builds it on the repository's web URL, so nothing it
 * is given can become markup.
 */
export function markMentions(html: string, context: MentionContext): string {
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
      if (context.files && WHOLE_FILE_NAME.test(node.data.trim())) markFile(parent, node.data.trim())
    } else if (parent.closest('code') === null) markProse(node, context)
  }
  return root.innerHTML
}
