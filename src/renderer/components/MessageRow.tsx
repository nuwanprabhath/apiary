import { useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { ToolBlock } from './ToolBlock'
import { MarkdownText } from './MarkdownText'

function summarise(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

export function MessageRow({ message }: { message: TranscriptMessage }): JSX.Element {
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
              return <MarkdownText key={i} text={block.text} />
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
