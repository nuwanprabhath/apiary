import { type JSX, memo } from 'react'
import { MarkdownText } from '../../ui/message/MarkdownText'
import { splitStreaming } from './streamingSplit'

// The finished paragraphs are the same string between updates, so memo keeps their parsed HTML.
const Finished = memo(MarkdownText)

/** A reply that is still being written: only the paragraph in progress is parsed on each update. */
export function StreamingMarkdown({ text }: { text: string }): JSX.Element {
  const { done, tail } = splitStreaming(text)
  return (
    <>
      {done !== '' && <Finished text={done} />}
      {tail !== '' && <MarkdownText text={tail} />}
    </>
  )
}
