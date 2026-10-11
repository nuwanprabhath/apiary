import { type JSX, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { mentionHandlers, useFileMentions } from './FileMentions'
import { markFileMentions } from './mentionMarkup'

// GitHub-flavoured line breaks (a single newline inside a paragraph becomes <br>) match how
// Claude's own text reads best here — its messages are written more like chat than prose, where
// a hard-wrapped line is usually meant to stay a visual line break, not fold into the paragraph
// above it.
marked.setOptions({ breaks: true, gfm: true })

// DOMPurify's *default* allowlist includes `form`, `input`, `button`, `select`, `dialog`,
// `style` and `template` — none of which markdown ever needs, and all of which a hostile
// transcript could use to draw a fake dialog or a form that posts typed input somewhere else.
// This is exactly what markdown produces and nothing more: text formatting, code, tables, GFM
// task-list checkboxes, and links.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'span',
]
const ALLOWED_ATTR = ['href', 'title', 'align', 'type', 'checked', 'disabled', 'start', 'class']
// Absolute http(s)/mailto links only. A relative href (`?restore=...`) would resolve to the
// app's own index.html with attacker-chosen query, which `navigationGuard` treats as a same-app
// reload — closing that off here means it never has to be closed off there.
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
  // Belt-and-braces alongside ALLOWED_URI_REGEXP: strip any href that isn't an absolute
  // http(s)/mailto URL, so a relative link can never reach the app's own page with a new query.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return
    const href = node.getAttribute('href')
    if (href === null) return
    if (!ALLOWED_URI_REGEXP.test(href)) node.removeAttribute('href')
  })
}

/**
 * Renders a transcript text block as markdown. Message text is model output, not something we
 * authored, so it is sanitised with DOMPurify before ever reaching `dangerouslySetInnerHTML` —
 * without that, an `<img onerror=...>` (or similar) embedded in a session's own JSONL — imported
 * from disk, not typed by this app's user — would execute in the renderer.
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

  // Sanitised with DOMPurify just above, so the HTML this sets is safe.
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- html is DOMPurify-sanitised above
  return <div className="markdown text-block" {...mentionHandlers(mentions)} dangerouslySetInnerHTML={{ __html: html }} />
}
