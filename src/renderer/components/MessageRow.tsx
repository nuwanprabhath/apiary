import { useState } from 'react'
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
function TextBlock(
  { text, onOpenImage }: { text: string; onOpenImage: (src: string) => void },
): JSX.Element {
  const segments: Array<{ kind: 'text' | 'image'; value: string }> = []
  for (const line of text.split('\n')) {
    const match = IMAGE_PATH_LINE.exec(line)
    if (match !== null) {
      segments.push({ kind: 'image', value: match[1] })
      continue
    }
    const last = segments[segments.length - 1]
    if (last?.kind === 'text') last.value += '\n' + line
    else segments.push({ kind: 'text', value: line })
  }

  return (
    <>
      {segments.map((seg, i) => (seg.kind === 'image'
        ? <TranscriptImageFile key={i} path={seg.value} fallbackText={seg.value} onOpen={onOpenImage} />
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

export function MessageRow(
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
          switch (block.type) {
            case 'text':
              return <TextBlock key={i} text={block.text} onOpenImage={onOpenImage} />
            case 'image':
              return <ImageThumbnail key={i} src={block.dataUrl} onOpen={onOpenImage} />
            case 'thinking':
              return (
                <div key={i} className="thinking" data-testid="thinking-block">
                  <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
                    {showThinking ? 'Hide thinking' : 'Show thinking'}
                  </button>
                  {showThinking && <pre className="tool-body">{block.text}</pre>}
                </div>
              )
            case 'tool_use':
              return <ToolBlock key={i} name={block.name} detail={summarise(block.input)} />
            case 'tool_result':
              return (
                <ToolBlock
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
}
