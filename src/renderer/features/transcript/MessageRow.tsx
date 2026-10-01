import { type JSX, memo, useMemo, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { ToolBlock } from './ToolBlock'
import { MarkdownText } from './MarkdownText'
import { ImageThumbnail, TranscriptImageFile, IMAGE_PATH_LINE } from './TranscriptImage'

/**
 * Renders a text block, turning any line that is just the path to an image into a thumbnail.
 *
 * That shape is exactly what the composer sends: Claude reads an image from its path, so an image
 * pasted into the chat box arrives in the transcript as a line of prose plus a path. Showing the
 * picture back is what makes the sent message look like the message that was written.
 */
export function TextBlock(
  { text, onOpenImage }: { text: string; onOpenImage: (src: string) => void },
): JSX.Element {
  // UI-8: re-deriving this by splitting `text` and running the image regex on every render was
  // wasted work whenever the row re-rendered for a reason that had nothing to do with this block
  // (`showThinking` toggling elsewhere in the same message, most commonly).
  const segments = useMemo(() => {
    const result: Array<{ kind: 'text' | 'image'; value: string }> = []
    for (const line of text.split('\n')) {
      const match = IMAGE_PATH_LINE.exec(line)
      if (match !== null) {
        result.push({ kind: 'image', value: match[1] })
        continue
      }
      const last = result[result.length - 1]
      if (last?.kind === 'text') last.value += '\n' + line
      else result.push({ kind: 'text', value: line })
    }
    return result
  }, [text])

  return (
    <>
      {/* Segments are re-derived from `text` on every render in a fixed order with no id of
          their own, so the index is a stable, correct key here. */}
      {segments.map((seg, i) => (seg.kind === 'image'
        // eslint-disable-next-line @eslint-react/no-array-index-key -- segments have no identity; re-derived in a fixed order from `text` each render
        ? <TranscriptImageFile key={i} path={seg.value} fallbackText={seg.value} onOpen={onOpenImage} />
        // eslint-disable-next-line @eslint-react/no-array-index-key -- segments have no identity; re-derived in a fixed order from `text` each render
        : seg.value.trim() === '' ? null : <MarkdownText key={i} text={seg.value} />))}
    </>
  )
}

function summarise(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

/**
 * UI-8: a `tool_use` block used to call `summarise` — `JSON.stringify(input, null, 2)` for
 * anything but a plain string — inline in `MessageRow`'s render, so it reran for every block in a
 * message whenever *any* block in that message re-rendered (`showThinking` toggling on an
 * unrelated block in the same message, most commonly). `input` never changes after the message is
 * parsed, so memoising it here means a block's own summary is computed once and reused.
 */
function ToolUseBlock({ name, input }: { name: string; input: unknown }): JSX.Element {
  const detail = useMemo(() => summarise(input), [input])
  return <ToolBlock name={name} detail={detail} />
}

// UI-4 step 3: `mergeLatestPage` (Transcript.tsx) keeps object identity for messages already in the
// list, and `onOpenImage` is a setState function (stable across renders), so an unmemoised row
// re-rendered on every App render — including every ~1s live-refresh tick — even when its own
// message and callback had not changed at all.
export const MessageRow = memo(function MessageRow(
  { message, onOpenImage }: { message: TranscriptMessage; onOpenImage: (src: string) => void },
): JSX.Element {
  const [showThinking, setShowThinking] = useState(false)

  return (
    <article
      className="message"
      data-testid="message"
      data-role={message.role}
      data-sidechain={message.isSidechain}
    >
      <div className="message-role">{message.role === 'user' ? 'You' : 'Claude'}</div>
      <div className="message-body">
        {message.blocks.map((block, i) => {
          // Blocks have no id of their own and this message's block list never reorders or
          // mutates in place after being parsed from the JSONL, so the index is a stable key.
          switch (block.type) {
            case 'text':
              // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks have no identity; this message's block order is fixed
              return <TextBlock key={i} text={block.text} onOpenImage={onOpenImage} />
            case 'image':
              // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks have no identity; this message's block order is fixed
              return <ImageThumbnail key={i} src={block.dataUrl} onOpen={onOpenImage} />
            case 'thinking':
              return (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks have no identity; this message's block order is fixed
                <div key={i} className="thinking" data-testid="thinking-block">
                  <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
                    {showThinking ? 'Hide thinking' : 'Show thinking'}
                  </button>
                  {showThinking && <pre className="tool-body">{block.text}</pre>}
                </div>
              )
            case 'tool_use':
              // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks have no identity; this message's block order is fixed
              return <ToolUseBlock key={i} name={block.name} input={block.input} />
            case 'tool_result':
              return (
                <ToolBlock
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks have no identity; this message's block order is fixed
                  key={i}
                  name={block.isError ? 'Result (error)' : 'Result'}
                  detail={block.content}
                  isError={block.isError}
                />
              )
            default:
              return null
          }
        })}
      </div>
    </article>
  )
})
