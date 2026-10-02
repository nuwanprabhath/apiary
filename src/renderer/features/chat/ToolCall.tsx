import { type JSX, memo, useMemo, useState } from 'react'
import { describeTool } from '@shared/chatTimeline'

/** How much of an IN or OUT box shows until it is opened: the extension's first few lines. */
const CLIP_LINES = 3
/** A box with fewer lines is still clipped past this many characters — one minified line of JSON
 *  is three lines of text only on paper. The CSS clips it to the same three lines' height. */
const CLIP_CHARS = 400

/**
 * One box of a tool call: its first three lines, and the rest behind "Show all N lines" (or a
 * click anywhere on it). Both boxes clip the same way — a heredoc in a Bash command is as long as
 * any output.
 */
function IoBox({ label, text, testId }: { label: string; text: string; testId: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = useMemo(() => text.split('\n'), [text])
  const long = lines.length > CLIP_LINES || text.length > CLIP_CHARS
  const clipped = long && !open
  return (
    <div className="chat-io-row">
      <span className="chat-io-label">{label}</span>
      <div className="chat-io-body">
        <pre
          className="chat-io-text"
          data-testid={testId}
          data-clipped={clipped}
          // Clicking a clipped box opens it, as in the extension. Not a button: the text in it
          // has to stay selectable, and a click that ends a selection is not a request to open.
          onClick={clipped ? () => { if (window.getSelection()?.isCollapsed !== false) setOpen(true) } : undefined}
        >
          {clipped ? lines.slice(0, CLIP_LINES).join('\n') : text}
        </pre>
        {long && (
          <button className="chat-io-more" data-testid={`${testId}-more`} onClick={() => { setOpen(!open) }}>
            {open ? 'Show less' : `Show all ${String(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}`}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One tool call as the extension draws it: a status dot, the tool's name and what the call is
 * for, then an IN box (the command, the path, the pattern) and an OUT box (what came back). The
 * dot is grey while the call waits for its result, green once it has one, red for an error.
 */
export const ToolCall = memo(function ToolCall(
  { name, input, result }: { name: string; input: unknown; result: { content: string; isError: boolean } | null },
): JSX.Element {
  const described = useMemo(() => describeTool(name, input), [name, input])
  const out = result?.content ?? ''
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
          <IoBox label="IN" text={described.input} testId="chat-tool-in" />
          {result !== null && out !== '' && <IoBox label="OUT" text={out} testId="chat-tool-out" />}
        </div>
      </div>
    </div>
  )
})
