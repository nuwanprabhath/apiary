import { type ComponentProps, type Dispatch, type JSX, type ReactNode } from 'react'
import type { SessionNode } from '@shared/types'
import type { Column } from '../state/columns'
import { foldState, presetDef, type PresetId } from '../state/layout'
import { PaneGrid } from '../features/layout/PaneGrid'
import { PaneFiller } from '../features/pane/PaneFiller'
import type { PendingTabInfo } from '../features/pane/paneTypes'
import { SessionColumn } from '../features/pane/SessionColumn'
import type { WorkspaceAction } from '../features/workspace/workspaceReducer'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { crashNotice } from '../ui/errors'
import { useNotifications } from '../ui/notifications'
import type { ColumnHandlers } from './useColumnHandlers'

/** What every column receives the same of — each a stable reference (see appPropStability.test.tsx). */
type SharedColumnProps = Omit<ComponentProps<typeof SessionColumn>,
  'column' | 'gridArea' | 'isActive' | 'layoutButton' | 'emptyContent' | 'fold' | keyof ColumnHandlers>

type Props = SharedColumnProps & {
  columns: Column[]
  preset: PresetId
  activeColumnId: string
  columnHandlers: Map<string, ColumnHandlers>
  layoutMenuButton: ReactNode
  dispatch: Dispatch<WorkspaceAction>
  openSessions: Map<string, SessionNode>
  pendingTabInfo: Map<string, PendingTabInfo>
  openKeySet: Set<string>
}

/** The pane grid and one `SessionColumn` per column, each failing alone inside its own zone. */
export function PaneColumns({
  columns, preset, activeColumnId, columnHandlers, layoutMenuButton, dispatch, openSessions,
  pendingTabInfo, openKeySet, ...shared
}: Props): JSX.Element {
  const { notify } = useNotifications()
  return (
    <PaneGrid preset={preset} folded={columns.map((c) => c.collapsed === true)}>
      {columns.map((column, index) => {
        // columnHandlers is built from exactly these columns' ids (see its own comment), so this is
        // always present — the `!` records that invariant rather than papering over a real
        // possibility of `undefined`.
        const handlers = columnHandlers.get(column.id)!
        return (
          // Per pane, not just once around the whole app: a pane whose session renders badly (a
          // transcript with something unexpected in it, say) should fail inside its own zone and
          // leave the sidebar and the other panes working, rather than blanking the window.
          <ErrorBoundary
            key={column.id}
            label="This session"
            onError={(thrown, componentStack) => { notify(crashNotice('This session', thrown, componentStack)) }}
            style={{ gridArea: `z${String(index + 1)}` }}
          >
            <SessionColumn
              {...shared}
              gridArea={`z${String(index + 1)}`}
              column={column}
              isActive={column.id === activeColumnId}
              onFocus={handlers.onFocus}
              onActivateTab={handlers.onActivateTab}
              onCloseTab={handlers.onCloseTab}
              onSetView={handlers.onSetView}
              onReorderTab={handlers.onReorderTab}
              fold={foldState({ preset, panes: columns }, index)}
              onFold={handlers.onFold}
              layoutButton={index === presetDef(preset).topRight ? layoutMenuButton : undefined}
              emptyContent={column.placeholder === true ? (
                <PaneFiller
                  openTabs={columns
                    // A pane's only tab is excluded: moving it would empty that pane and step the
                    // layout down, so the click would look like it did nothing. The picker can still
                    // move it deliberately.
                    .filter((c) => c.id !== column.id && c.tabs.length > 1)
                    .flatMap((c) => c.tabs)
                    .map((t) => ({
                      key: t.key,
                      label: openSessions.get(t.key)?.title ?? pendingTabInfo.get(t.key)?.label ?? t.key,
                    }))}
                  exclude={openKeySet}
                  onMoveHere={(key) => { dispatch({ type: 'tab/move', key, toColumnId: column.id, toIndex: 0 }) }}
                  onOpenHere={(session) => {
                    dispatch({ type: 'openSessions/set', session })
                    dispatch({ type: 'tab/activate', columnId: column.id, key: session.sessionId })
                  }}
                  onClosePane={() => { dispatch({ type: 'layout/closePane', columnId: column.id }) }}
                />
              ) : undefined}
            />
          </ErrorBoundary>
        )
      })}
    </PaneGrid>
  )
}
