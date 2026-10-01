import { type JSX, memo, useMemo, useState } from 'react'
import { describeTool } from '@shared/chatTimeline'

/** Output longer than this many lines is clipped until "Show all" is clicked. */
const CLIP_LINES = 8

/**
 * One tool call as the extension draws it: a status dot, the tool's name and what the call is
 * for, then an IN box (the command, the path, the pattern) and an OUT box (what came back). The
 * dot is grey while the call waits for its result, green once it has one, red for an error.
 */
export const ToolCall = memo(function ToolCall(
  { name, input, result }: { name: string; input: unknown; result: { content: string; isError: boolean } | null },
): JSX.Element {
  const described = useMemo(() => describeTool(name, input), [name, input])
  const [showAll, setShowAll] = useState(false)
  const out = result?.content ?? ''
  const lines = useMemo(() => out.split('\n'), [out])
  const clipped = !showAll && lines.length > CLIP_LINES
  const status = result === null ? 'pending' : result.isError ? 'error' : 'ok'

  return (
    <div className="chat-row chat-tool" data-testid="chat-tool" data-tool={name} data-status={status}>
      <span className="chat-dot" aria-hidden="true" />
      <div className="chat-row-body">
        <div className="chat-tool-head">
          <span className="chat-tool-name">{name}</span>
          {described.title !== '' && <span className="chat-tool-title">{described.title}</span>}
        </div>
        <div className="chat-io">
          <div className="chat-io-row">
            <span className="chat-io-label">IN</span>
            <pre className="chat-io-text" data-testid="chat-tool-in">{described.input}</pre>
          </div>
          {result !== null && out !== '' && (
            <div className="chat-io-row">
              <span className="chat-io-label">OUT</span>
              <div className="chat-io-out">
                <pre className="chat-io-text" data-testid="chat-tool-out" data-clipped={clipped}>
                  {clipped ? lines.slice(0, CLIP_LINES).join('\n') : out}
                </pre>
                {lines.length > CLIP_LINES && (
                  <button className="chat-io-more" data-testid="chat-tool-more" onClick={() => { setShowAll(!showAll) }}>
                    {showAll ? 'Show less' : `Show all ${String(lines.length)} lines`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
