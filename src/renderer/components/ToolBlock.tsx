import { useState } from 'react'

interface Props {
  name: string
  detail: string
  isError?: boolean
}

/** A collapsed one-line summary that expands to the full payload. */
export function ToolBlock({ name, detail, isError = false }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const firstLine = detail.split('\n')[0].slice(0, 120)

  return (
    <div className="tool-block" data-testid="tool-block" data-error={isError}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-name">{name}</span>
        {!open && <span className="tool-preview">{firstLine}</span>}
        {/* .tool-preview is the row's only flex:1 spacer, and it disappears once expanded —
         *  without a stand-in, the chevron loses whatever was pushing it to the right and
         *  jumps back to sit right after the name instead of staying in a fixed place. */}
        {open && <span className="spacer" />}
        <svg
          className="chevron"
          data-expanded={open}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <pre className="tool-body">{detail}</pre>}
    </div>
  )
}
