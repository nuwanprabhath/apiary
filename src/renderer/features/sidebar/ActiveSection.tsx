import { type JSX, useMemo, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { UNTITLED_SESSION } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { describeActivityStatus } from '@shared/activity'
import { NoteIcon } from '../../ui/icons'
import { useFlatTreeNav } from '../../ui/Tree'
import { ActivityLegend } from './ActivityLegend'
import { MrRefText } from '../../ui/mrRefText'
import type { SessionId } from '@shared/domain/ids'
import { sessionIdOfTabKey } from '../workspace'
import { useMrStatuses } from './useMrStatuses'
import { remoteHost, windowNumber } from '../../state/windowParams'

/** Its own component because the lookup is a hook and the rows are produced in a `map`. */
function ActiveTabTitle({ sessionId, title }: { sessionId: SessionId; title: string }): JSX.Element {
  const statuses = useMrStatuses(sessionId, title)
  return <span className="session-title"><MrRefText text={title} statuses={statuses} /></span>
}

/** One row per session: the tabs of a session shown in several panes or windows collapse into the
 *  first of them, which lists every window number it is open in. */
interface ActiveRow extends ActiveTabPayload { windows: number[] }

function groupActiveTabs(tabs: ActiveTabPayload[]): ActiveRow[] {
  const rows = new Map<string, ActiveRow>()
  for (const t of tabs) {
    const row = rows.get(t.key)
    if (row === undefined) rows.set(t.key, { ...t, windows: [t.windowNumber] })
    else if (!row.windows.includes(t.windowNumber)) row.windows.push(t.windowNumber)
  }
  return [...rows.values()]
}

const activeKeyOf = (t: ActiveTabPayload): string => t.key

/** The window a click goes to: this one when the tab is open here, so it is selected without a
 *  round trip (and in a remote window, where main refuses to raise a window on the work machine's
 *  screen, at all). */
const targetWindow = (row: ActiveRow, own: number): number => (row.windows.includes(own) ? own : row.windowNumber)

export function ActiveSection({ activeTabs, sessionsById, onFocusTab, onEditNote }: {
  activeTabs: ActiveTabPayload[]
  /** Every session known anywhere, unfiltered — what titles are resolved against. The
   *  search-filtered tree would leave a tab open in another window as a bare session id. */
  sessionsById: Map<string, SessionNode>
  onFocusTab: (windowNumber: number, key: string) => void
  onEditNote: (session: SessionNode) => void
}): JSX.Element {
  const [legendAnchor, setLegendAnchor] = useState<DOMRect | null>(null)
  // Its own flat WAI-ARIA tree: no expand/collapse, and Enter raises the tab's window like a click.
  const rows = useMemo(() => groupActiveTabs(activeTabs), [activeTabs])
  const own = windowNumber()
  const host = remoteHost()
  /** In a remote window, a row for a tab open only in another work-machine window cannot be
   *  raised: that window is on a screen nobody here sees. */
  const isInert = (row: ActiveRow): boolean => host !== null && !row.windows.includes(own)
  const activeByKey = useMemo(() => new Map(rows.map((t) => [activeKeyOf(t), t])), [rows])
  const activeTree = useFlatTreeNav(rows.map(activeKeyOf), {
    onEnter: (current) => {
      const t = current.dataset.treeKey === undefined ? undefined : activeByKey.get(current.dataset.treeKey)
      if (t !== undefined && !isInert(t)) onFocusTab(targetWindow(t, own), t.key)
    },
  })
  return (
    <section className="active-section" data-testid="active-section" aria-label="Active sessions">
      {/* Focusable: the legend is the only place the four dots are explained. */}
      <div
        className="pinned-header active-header"
        data-testid="active-header"
        tabIndex={0}
        onPointerEnter={(e) => { setLegendAnchor(e.currentTarget.getBoundingClientRect()) }}
        onPointerLeave={() => { setLegendAnchor(null) }}
        onFocus={(e) => { setLegendAnchor(e.currentTarget.getBoundingClientRect()) }}
        onBlur={() => { setLegendAnchor(null) }}
      >
        <span className="pinned-label">Active</span>
        <span className="pinned-count">{rows.length}</span>
      </div>
      {legendAnchor !== null && <ActivityLegend anchor={legendAnchor} />}
      <div
        role="tree"
        aria-label="Active sessions"
        ref={activeTree.ref}
        onKeyDown={activeTree.onKeyDown}
        onFocus={activeTree.onFocus}
      >
      {rows.map((t) => {
        const session = sessionsById.get(t.key)
        const key = activeKeyOf(t)
        return (
          // A wrapper, like a session row's: the row is a <button>, and a button cannot hold the
          // note button beside it.
          <div
            key={key}
            className="session-row-wrap active-row-wrap"
            role="treeitem"
            // Stable, like the other rows': an unresolved tab's title changes once Claude writes it.
            aria-label={session?.title ?? t.label ?? UNTITLED_SESSION}
            aria-level={1}
            data-tree-kind="active"
            data-tree-key={key}
            tabIndex={activeTree.tabIndexFor(key)}
          >
            <button
              className={isInert(t) ? 'session-row active-tab-row active-tab-row-inert' : 'session-row active-tab-row'}
              data-testid="active-tab-row"
              aria-disabled={isInert(t) || undefined}
              onClick={() => { if (!isInert(t)) onFocusTab(targetWindow(t, own), t.key) }}
              title={isInert(t)
                ? `Open on ${host ?? 'the work machine'}'s screen`
                : t.windows.length === 1 ? `Window ${String(t.windowNumber)}` : `Windows ${t.windows.join(', ')}`}
              // The wrap above is the treeitem; Enter on it already raises this tab's
              // window, so this stays clickable but is not a second Tab stop.
              tabIndex={-1}
            >
              <span
                className="status-dot"
                data-testid="active-status-dot"
                data-status={t.status}
                role="img"
                aria-label={describeActivityStatus(t.status)}
              />
              <ActiveTabTitle sessionId={sessionIdOfTabKey(t.key)} title={session?.title ?? t.label ?? UNTITLED_SESSION} />
              <span className="active-window-number">{t.windows.map((n) => `W${String(n)}`).join(' ')}</span>
            </button>
            {/* A tab still waiting for its session id has no session to attach a note to yet. */}
            {session !== undefined && (
              <button
                className="row-action note-session-button"
                data-testid="active-note-button"
                data-has-note={session.note !== null && session.note !== ''}
                title={session.note !== null && session.note !== '' ? 'Edit note' : 'Add a note'}
                aria-label={`Edit the note on ${session.title}`}
                onClick={(e) => { e.stopPropagation(); onEditNote(session) }}
              >
                <NoteIcon filled={session.note !== null && session.note !== ''} />
              </button>
            )}
          </div>
        )
      })}
      </div>
    </section>
  )
}
