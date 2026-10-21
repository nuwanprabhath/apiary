import { type JSX, useState } from 'react'
import { ChevronIcon } from '../icons/ChevronIcon'
import { MarkdownText } from './MarkdownText'

/** Longer than this, a report starts folded to its first line: a subagent's can run to pages, and
 *  scrolling back past a few of them to find what you asked was the problem. */
const FOLD_LINES = 4
const FOLD_CHARS = 400

/** The first line worth showing: not blank, without a heading's or a list item's marker. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, '').trim()
}

function isLongPeerMessage(text: string): boolean {
  return text.length > FOLD_CHARS || text.trim().split('\n').length > FOLD_LINES
}

/**
 * Another Claude session's message to this one, a subagent's report back among them. Not a prompt
 * you wrote, so it is labelled with who sent it; a long one is folded to its first line, and the
 * header opens it.
 */
export function PeerMessage({ from, text }: { from: string | null; text: string }): JSX.Element {
  const long = isLongPeerMessage(text)
  const [open, setOpen] = useState(!long)
  const sender = from === null ? 'Another Claude session' : `${from} agent`
  return (
    <div className="peer-message" data-testid="peer-message" data-open={open}>
      {long ? (
        <button
          type="button"
          className="peer-message-head"
          data-testid="peer-message-toggle"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <span className="peer-message-chevron" aria-hidden="true"><ChevronIcon expanded={open} /></span>
          <span className="peer-message-from">{sender}</span>
          {!open && <span className="peer-message-first" title={firstLine(text)}>{firstLine(text)}</span>}
        </button>
      ) : (
        <div className="peer-message-head"><span className="peer-message-from">{sender}</span></div>
      )}
      {open && <div className="peer-message-body"><MarkdownText text={text} /></div>}
    </div>
  )
}
