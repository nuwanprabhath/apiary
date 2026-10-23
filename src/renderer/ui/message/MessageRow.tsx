import { type JSX, memo, useMemo, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { MessageTime } from '../MessageTime'
import { ToolBlock } from './ToolBlock'
import { MarkdownText } from './MarkdownText'
import { LoadedMessage, PeerMessage } from './FoldedMessage'
import { ImageThumbnail, TranscriptImageFile, IMAGE_PATH_LINE } from './TranscriptImage'

/**
 * A text block, with any line that is just the path to an image shown as a thumbnail: the composer
 * sends a pasted image to Claude as a path on its own line.
 */
export function TextBlock(
  { text, onOpenImage }: { text: string; onOpenImage: (src: string) => void },
): JSX.Element {
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

/** `input` never changes after the message is parsed, so its summary is computed once per block. */
function ToolUseBlock({ name, input }: { name: string; input: unknown }): JSX.Element {
  const detail = useMemo(() => summarise(input), [input])
  return <ToolBlock name={name} detail={detail} />
}

// `mergeLatestPage` keeps object identity for messages already in the list, and `onOpenImage` is a
// stable setState function, so memo skips the row on every ~1s live-refresh tick.
export const MessageRow = memo(function MessageRow(
  { message, onOpenImage }: { message: TranscriptMessage; onOpenImage: (src: string) => void },
): JSX.Element | null {
  const [showThinking, setShowThinking] = useState(false)
  // A turn's end and a recap are the chat view's (ChatStatus); this view has no place for them.
  if (message.blocks.every((b) => b.type === 'turn_end' || b.type === 'recap' || b.type === 'task_ended')) return null

  return (
    <article
      className="message"
      data-testid="message"
      data-role={message.role}
      data-sidechain={message.isSidechain}
    >
      {message.role === 'user' && <MessageTime ms={message.timestampMs} />}
      <div className="message-role">{message.role === 'user' ? 'You' : 'Claude'}</div>
      <div className="message-body">
        {message.role !== 'user' && message.blocks.some((b) => b.type === 'text') && <MessageTime ms={message.timestampMs} inline />}
        {message.blocks.map((block, i) => {
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
            case 'peer_message':
              // A peer message is one block, the message's only one.
              return <PeerMessage key="peer" from={block.from} text={block.text} />
            case 'loaded_context':
              // Likewise one block, the message's only one.
              return <LoadedMessage key="loaded" name={block.name} text={block.text} />
            case 'turn_end':
            case 'recap':
            case 'task_ended':
              return null
          }
        })}
      </div>
    </article>
  )
})
