import { type JSX, useMemo, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { UNTITLED_SESSION } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { describeActivityStatus } from '@shared/activity'
import { NoteIcon } from '../../ui/icons'
import { useFlatTreeNav } from '../../ui/Tree'
import { ActivityLegend } from './ActivityLegend'
import { MrRefText } from './mrRefText'
import type { SessionId } from '@shared/domain/ids'
import { sessionIdOfTabKey } from '../workspace'
import { useMrStatuses } from './useMrStatuses'

/**
 * An Active row's title, with any `!<iid>` in it resolved to its merge-request state.
 *
 * Its own component because the lookup is a hook, and the rows are produced in a `map` where a
 * hook cannot go. Active is the section meant to be read at a glance without opening anything, so
 * it is the last place that should be showing a staler title than the tree.
 */
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

/** Every open tab across every window, above Pinned. */
export function ActiveSection({ activeTabs, sessionsById, onFocusTab, onEditNote }: {
  activeTabs: ActiveTabPayload[]
  /** Every session known anywhere, unfiltered — what titles are resolved against. Using the
   *  search-filtered tree here would turn a row for a tab open in *another* window into a bare,
   *  unreadable session id the moment this window's own search box excludes that tab's project. */
  sessionsById: Map<string, SessionNode>
  /** Raises the window showing a tab and switches it to that tab. */
  onFocusTab: (windowNumber: number, key: string) => void
  onEditNote: (session: SessionNode) => void
}): JSX.Element {
  /** The Active header's rect while the pointer (or focus) is on it — see ActivityLegend. */
  const [legendAnchor, setLegendAnchor] = useState<DOMRect | null>(null)
  /**
   * UI-27: Active is its own flat WAI-ARIA tree — a list of open tabs across every window, not
   * part of the folder/session hierarchy, so it gets no expand/collapse and Enter just raises the
   * tab's own window (`onFocusTab`), same as a click.
   */
  const rows = useMemo(() => groupActiveTabs(activeTabs), [activeTabs])
  const activeByKey = useMemo(() => new Map(rows.map((t) => [activeKeyOf(t), t])), [rows])
  const activeTree = useFlatTreeNav(rows.map(activeKeyOf), {
    onEnter: (current) => {
      const t = current.dataset.treeKey === undefined ? undefined : activeByKey.get(current.dataset.treeKey)
      if (t !== undefined) onFocusTab(t.windowNumber, t.key)
    },
  })
  return (
    <section className="active-section" data-testid="active-section" aria-label="Active sessions">
      {/* Focusable, and it answers hover as well as focus: the legend below is the only place
          the four dots are ever explained, so it has to be reachable without a pointer. */}
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
            // Stable, like the other rows' — an unresolved tab's title changes once Claude
            // writes it, and that must not also change the treeitem's own accessible name.
            aria-label={session?.title ?? t.label ?? UNTITLED_SESSION}
            aria-level={1}
            data-tree-kind="active"
            data-tree-key={key}
            tabIndex={activeTree.tabIndexFor(key)}
          >
            <button
              className="session-row active-tab-row"
              data-testid="active-tab-row"
              onClick={() => onFocusTab(t.windowNumber, t.key)}
              title={t.windows.length === 1 ? `Window ${String(t.windowNumber)}` : `Windows ${t.windows.join(', ')}`}
              // UI-27: the wrap above is the treeitem; Enter on it already raises this tab's
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
