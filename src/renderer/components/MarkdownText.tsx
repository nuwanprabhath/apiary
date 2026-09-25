import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// GitHub-flavoured line breaks (a single newline inside a paragraph becomes <br>) match how
// Claude's own text reads best here — its messages are written more like chat than prose, where
// a hard-wrapped line is usually meant to stay a visual line break, not fold into the paragraph
// above it.
marked.setOptions({ breaks: true, gfm: true })

/**
 * Renders a transcript text block as markdown. Message text is model output, not something we
 * authored, so it is sanitised with DOMPurify before ever reaching `dangerouslySetInnerHTML` —
 * without that, an `<img onerror=...>` (or similar) embedded in a session's own JSONL — imported
 * from disk, not typed by this app's user — would execute in the renderer.
 */
export function MarkdownText({ text }: { text: string }): JSX.Element {
  const html = useMemo(() => {
    const rendered = marked.parse(text, { async: false })
    return DOMPurify.sanitize(rendered)
  }, [text])

  // Sanitised with DOMPurify just above, so the HTML this sets is safe.
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- html is DOMPurify-sanitised above
  return <div className="markdown text-block" dangerouslySetInnerHTML={{ __html: html }} />
}
