import { type JSX, type MouseEvent, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { mentionHandlers, useFileMentions } from './FileMentions'
import { markFileMentions } from './mentionMarkup'
import { copyText } from '../../state/clipboard'

// A single newline inside a paragraph becomes <br>: Claude's messages are written like chat, where
// a hard-wrapped line is meant to stay a line break.
marked.setOptions({ breaks: true, gfm: true })
// GFM in marked also strikes through text between single tildes, so a pasted prompt such as
// `me@host:~$ ls … me@host:~$` came out struck through. Only `~~text~~` is strikethrough: `false`
// hands a `~~` run to marked's own tokenizer, and anything else is not one.
marked.use({ tokenizer: { del: (src: string) => (src.startsWith('~~') ? false : undefined) } })

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
// DOMPurify tests ALLOWED_URI_REGEXP against every attribute not marked URI-safe, so `start="3"`,
// `align="right"` and `type="checkbox"` were dropped: a list numbered from 3 showed 1.
const ADD_URI_SAFE_ATTR = ['start', 'align', 'type']

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
const CHIP_TITLE_MAX = 300

/**
 * A Copy button on every code block (a command to run, a snippet), added after sanitising: the
 * button is the app's, never the message's, which may not contain one.
 */
function withCodeCopyButtons(html: string): string {
  if (!html.includes('<pre')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const pre of doc.querySelectorAll('pre')) {
    const button = doc.createElement('button')
    button.setAttribute('type', 'button')
    button.setAttribute('class', 'code-copy')
    button.setAttribute('data-testid', 'code-copy')
    button.setAttribute('aria-label', 'Copy code')
    button.setAttribute('title', 'Copy code')
    button.textContent = 'Copy'
    // Beside the block, not inside it: a long command scrolls the block sideways, and the button must stay put.
    const wrapper = doc.createElement('div')
    wrapper.setAttribute('class', 'code-block')
    pre.replaceWith(wrapper)
    wrapper.append(pre, button)
  }
  return doc.body.innerHTML
}

/** The code of a code block's Copy button, as it would be pasted: the block's text without the button. */
function codeOf(button: Element): string | null {
  const code = button.closest('.code-block')?.querySelector('pre code') ?? null
  return code === null ? null : (code.textContent ?? '').replace(/\n$/, '')
}

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
    // A title can be a whole prompt: one line in the chip, the (capped) text on hover.
    const label = (chips.labelOf(id) ?? a.textContent).replace(/\s+/g, ' ').trim()
    chip.textContent = label
    chip.setAttribute('title', label.slice(0, CHIP_TITLE_MAX))
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
      ? DOMPurify.sanitize(rendered, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, ADD_URI_SAFE_ATTR })
      : DOMPurify.sanitize(chipLinks(rendered, chips), {
        ALLOWED_TAGS: [...ALLOWED_TAGS, 'button'], ALLOWED_ATTR: [...ALLOWED_ATTR, 'data-testid', CHIP_ID_ATTR], ALLOWED_URI_REGEXP, ADD_URI_SAFE_ATTR,
      })
    return withCodeCopyButtons(linkFiles ? markFileMentions(clean) : clean)
  }, [text, linkFiles, chips])

  const handlers = mentionHandlers(mentions)
  const onClick = (e: MouseEvent<HTMLElement>): void => {
    const target = e.target instanceof Element ? e.target : null
    const copyButton = target?.closest('.code-copy') ?? null
    if (copyButton !== null) {
      const code = codeOf(copyButton)
      if (code !== null) {
        void copyText(code).then((ok) => {
          if (!ok) return
          copyButton.textContent = 'Copied'
          setTimeout(() => { copyButton.textContent = 'Copy' }, 1500)
        })
      }
      return
    }
    const id = chips === undefined ? null : target?.closest(`[${CHIP_ID_ATTR}]`)?.getAttribute(CHIP_ID_ATTR)
    if (chips !== undefined && typeof id === 'string') chips.onOpen(id)
    else handlers.onClick?.(e)
  }
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- html is DOMPurify-sanitised above
  return <div className="markdown text-block" {...handlers} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
