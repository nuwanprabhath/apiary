import { type JSX, useMemo, useState } from 'react'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

interface Props {
  name: string
  detail: string
  isError?: boolean
}

/** A collapsed one-line summary that expands to the full payload. */
export function ToolBlock({ name, detail, isError = false }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  // UI-8: `detail.split('\n')` used to build an array of every line in the payload just to read
  // the first one — for a large tool output (a big diff, a long command's stdout) that is O(whole
  // payload) on every render to get 120 characters. `indexOf` finds the same cut point in one pass
  // and without allocating the rest of the lines; `useMemo` skips it entirely on an unrelated
  // re-render (`open` toggling has no effect on this, but the row above re-rendering does).
  const firstLine = useMemo(() => {
    const nl = detail.indexOf('\n')
    return (nl === -1 ? detail : detail.slice(0, nl)).slice(0, 120)
  }, [detail])

  return (
    <div className="tool-block" data-testid="tool-block" data-error={isError}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-name">{name}</span>
        {!open && <span className="tool-preview">{firstLine}</span>}
        {/* .tool-preview is the row's only flex:1 spacer, and it disappears once expanded —
         *  without a stand-in, the chevron loses whatever was pushing it to the right and
         *  jumps back to sit right after the name instead of staying in a fixed place. */}
        {open && <span className="spacer" />}
        <ChevronIcon expanded={open} />
      </button>
      {open && <pre className="tool-body">{detail}</pre>}
    </div>
  )
}
