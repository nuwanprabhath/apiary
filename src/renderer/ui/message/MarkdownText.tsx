import { type JSX, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { mentionHandlers, useFileMentions } from './FileMentions'
import { markFileMentions } from './mentionMarkup'

// A single newline inside a paragraph becomes <br>: Claude's messages are written like chat, where
// a hard-wrapped line is meant to stay a line break.
marked.setOptions({ breaks: true, gfm: true })

// DOMPurify's default allowlist includes `form`, `input`, `button`, `select`, `dialog`, `style`
// and `template`, which a hostile transcript could use to draw a fake dialog or a form that posts
// typed input elsewhere. This list is only what markdown produces.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'span',
]
const ALLOWED_ATTR = ['href', 'title', 'align', 'type', 'checked', 'disabled', 'start', 'class']
// Absolute http(s)/mailto links only: a relative href (`?restore=...`) would resolve to the app's
// own index.html with an attacker-chosen query, which `navigationGuard` treats as a same-app reload.
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:)/i

let hooksInstalled = false
function installSanitizeHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  // `input` is kept only for GFM task-list checkboxes; anything else it could be (a text box, a
  // submit button) is dropped and forced inert.
  DOMPurify.addHook('uponSanitizeElement', (node) => {
    if (node.nodeName !== 'INPUT') return
    const el = node as HTMLInputElement
    if (el.getAttribute('type') !== 'checkbox') {
      el.parentNode?.removeChild(el)
      return
    }
    el.setAttribute('disabled', '')
  })
  // Belt-and-braces alongside ALLOWED_URI_REGEXP.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return
    const href = node.getAttribute('href')
    if (href === null) return
    if (!ALLOWED_URI_REGEXP.test(href)) node.removeAttribute('href')
  })
}

/**
 * Renders a transcript text block as markdown. Message text is model output read from disk, so it
 * is sanitised with DOMPurify before reaching `dangerouslySetInnerHTML`; otherwise an
 * `<img onerror=...>` in a session's JSONL would execute in the renderer.
 */
export function MarkdownText({ text }: { text: string }): JSX.Element {
  // Set only when VS Code is available; without it the text stays exactly as markdown made it.
  const mentions = useFileMentions()
  const linkFiles = mentions !== null
  const html = useMemo(() => {
    installSanitizeHooks()
    const rendered = marked.parse(text, { async: false })
    const clean = DOMPurify.sanitize(rendered, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP })
    return linkFiles ? markFileMentions(clean) : clean
  }, [text, linkFiles])

  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- html is DOMPurify-sanitised above
  return <div className="markdown text-block" {...mentionHandlers(mentions)} dangerouslySetInnerHTML={{ __html: html }} />
}
