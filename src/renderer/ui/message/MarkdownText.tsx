import { type JSX, type MouseEvent, useMemo } from 'react'
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
 * Links whose href starts with `prefix`, drawn as chips (buttons) instead of links, for a caller
 * whose text cites things by link (a resident citing sessions). Without it the output is unchanged.
 */
export interface LinkChips {
  prefix: string
  className: string
  testId: string
  /** The chip's label for the id after the prefix; null keeps the link's own text. */
  labelOf: (id: string) => string | null
  onOpen: (id: string) => void
}

const CHIP_ID_ATTR = 'data-chip-id'

/** Turns the chips' links into buttons before sanitising, which drops an href it does not allow. */
function chipLinks(html: string, chips: LinkChips): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith(chips.prefix)) continue
    const id = href.slice(chips.prefix.length)
    const chip = doc.createElement('button')
    chip.setAttribute('type', 'button')
    chip.setAttribute('class', chips.className)
    chip.setAttribute('data-testid', chips.testId)
    chip.setAttribute(CHIP_ID_ATTR, id)
    chip.textContent = chips.labelOf(id) ?? a.textContent
    a.replaceWith(chip)
  }
  return doc.body.innerHTML
}

/**
 * Renders a transcript text block as markdown. Message text is model output read from disk, so it
 * is sanitised with DOMPurify before reaching `dangerouslySetInnerHTML`; otherwise an
 * `<img onerror=...>` in a session's JSONL would execute in the renderer.
 */
export function MarkdownText({ text, chips }: { text: string; chips?: LinkChips }): JSX.Element {
  // Set only when VS Code is available; without it the text stays exactly as markdown made it.
  const mentions = useFileMentions()
  const linkFiles = mentions !== null
  const html = useMemo(() => {
    installSanitizeHooks()
    const rendered = marked.parse(text, { async: false })
    const clean = chips === undefined
      ? DOMPurify.sanitize(rendered, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP })
      : DOMPurify.sanitize(chipLinks(rendered, chips), {
        ALLOWED_TAGS: [...ALLOWED_TAGS, 'button'], ALLOWED_ATTR: [...ALLOWED_ATTR, 'data-testid', CHIP_ID_ATTR], ALLOWED_URI_REGEXP,
      })
    return linkFiles ? markFileMentions(clean) : clean
  }, [text, linkFiles, chips])

  const handlers = mentionHandlers(mentions)
  const onClick = chips === undefined ? handlers.onClick : (e: MouseEvent<HTMLElement>): void => {
    const id = e.target instanceof Element ? e.target.closest(`[${CHIP_ID_ATTR}]`)?.getAttribute(CHIP_ID_ATTR) : null
    if (typeof id === 'string') chips.onOpen(id)
    else handlers.onClick?.(e)
  }
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- html is DOMPurify-sanitised above
  return <div className="markdown text-block" {...handlers} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
