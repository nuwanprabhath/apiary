import { type JSX, useState } from 'react'
import { ChevronIcon } from '../icons/ChevronIcon'
import { MarkdownText } from './MarkdownText'

/** Longer than this, a message starts folded to its first line: a subagent's report or a skill's
 *  instructions can run to pages, and scrolling back past a few of them to find what you asked
 *  was the problem. */
const FOLD_LINES = 4
const FOLD_CHARS = 400

/** The first line worth showing: not blank, not one `skip` matches, without a heading's or a list
 *  item's marker. */
function firstLine(text: string, skip: RegExp | null): string {
  const line = text.split('\n').find((l) => l.trim() !== '' && (skip === null || !skip.test(l))) ?? ''
  return line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*)/, '').trim()
}

function isLong(text: string): boolean {
  return text.length > FOLD_CHARS || text.trim().split('\n').length > FOLD_LINES
}

/**
 * Something in the conversation you did not write: labelled with where it came from, and folded
 * to its first line when long, its header opening it. `skip` leaves a line out of that first line
 * (a skill's "Base directory" line says nothing about it).
 */
function FoldedMessage({ label, text, skip = null, testId }: {
  label: string
  text: string
  skip?: RegExp | null
  testId: string
}): JSX.Element {
  const long = isLong(text)
  const [open, setOpen] = useState(!long)
  const first = firstLine(text, skip)
  return (
    <div className="folded-message" data-testid={testId} data-open={open}>
      {long ? (
        <button
          type="button"
          className="folded-message-head"
          data-testid={`${testId}-toggle`}
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <span className="folded-message-chevron" aria-hidden="true"><ChevronIcon expanded={open} /></span>
          <span className="folded-message-label">{label}</span>
          {!open && <span className="folded-message-first" title={first}>{first}</span>}
        </button>
      ) : (
        <div className="folded-message-head"><span className="folded-message-label">{label}</span></div>
      )}
      {open && <div className="folded-message-body"><MarkdownText text={text} /></div>}
    </div>
  )
}

/** Another Claude session's message to this one, a subagent's report back among them. */
export function PeerMessage({ from, text }: { from: string | null; text: string }): JSX.Element {
  return <FoldedMessage label={from === null ? 'Another Claude session' : `${from} agent`} text={text} testId="peer-message" />
}

/** Text a tool loaded into the conversation, a skill's instructions above all. */
export function LoadedMessage({ name, text }: { name: string | null; text: string }): JSX.Element {
  return (
    <FoldedMessage
      label={name === null ? 'Loaded for a tool' : `Skill · ${name}`}
      text={text}
      skip={/^Base directory for this skill:/}
      testId="loaded-message"
    />
  )
}
