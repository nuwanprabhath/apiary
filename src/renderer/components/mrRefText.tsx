import { Fragment } from 'react'
import { parseMrRefs } from '@shared/mrRefs'

export type MrState = 'opened' | 'merged' | 'closed' | 'locked'

/**
 * Renders `text` with every `!<iid>` reference it contains turned into `!1267 (merged)` in a
 * status colour, leaving text with no known status exactly as written — layout must not shift
 * just because a lookup has not landed yet.
 */
export function MrRefText(
  { text, statuses }: { text: string; statuses: Record<number, MrState | null> },
): JSX.Element {
  const refs = parseMrRefs(text)
  if (refs.length === 0) return <>{text}</>

  const parts: JSX.Element[] = []
  let cursor = 0
  refs.forEach((ref, i) => {
    parts.push(<Fragment key={`t${String(i)}`}>{text.slice(cursor, ref.index)}</Fragment>)
    const raw = `!${String(ref.iid)}`
    const state = statuses[ref.iid] ?? null
    parts.push(
      state === null
        ? <Fragment key={`r${String(i)}`}>{raw}</Fragment>
        : (
          <span key={`r${String(i)}`} className="mr-ref" data-state={state}>
            {raw} ({state})
          </span>
        ),
    )
    cursor = ref.index + raw.length
  })
  parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  return <>{parts}</>
}
