import { type Dispatch, useCallback, useMemo, useRef, useState } from 'react'
import { findColumnWithTab, type Column } from '../state/columns'
import type { Layout, PresetId } from '../state/layout'
import type { LayoutActions, LayoutState, PlaceTarget } from '../features/layout/layoutContext'
import { LayoutMenuButton } from '../features/layout/LayoutMenuButton'
import type { DialogRequest } from '../features/dialogs/useDialogs'
import type { WorkspaceAction } from '../features/workspace/workspaceReducer'
import { LayoutIcon } from '../ui/icons'

/**
 * What the layout menus, drag-to-swap and the tab bar's split button do to the pane grid, as the
 * two contexts every consumer reads.
 *
 * `isOpen` and `dropPaneOn` read the current columns / moving pane through a ref, so the
 * actions object is built once and never changes identity — otherwise every SessionRow,
 * FolderHeader and tab strip re-rendered on every change to them.
 */
export function usePaneLayout(
  dispatch: Dispatch<WorkspaceAction>,
  layout: Layout,
  columns: Column[],
  openDialog: (request: DialogRequest) => void,
) {
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  /** The pane being dragged onto another by its tab bar — see `swapPanes`. */
  const [movingPane, setMovingPane] = useState<string | null>(null)
  const movingPaneRef = useRef(movingPane)
  movingPaneRef.current = movingPane

  /**
   * The tab bar's split button: the active session opened again beside the current pane, keeping
   * the view it was on. With four panes it opens in the next pane instead (see `openBeside`).
   */
  const splitActiveTab = useCallback((key: string) => {
    dispatch({ type: 'tab/split', key })
  }, [dispatch])

  const placeTarget = useCallback((target: PlaceTarget, preset: PresetId, zone: number) => {
    dispatch(target.kind === 'tab'
      ? { type: 'layout/place', key: target.key, preset, zone, paneId: target.paneId }
      : { type: 'layout/place', key: target.session.sessionId, preset, zone, session: target.session })
  }, [dispatch])

  const applyLayout = useCallback((preset: PresetId) => {
    dispatch({ type: 'layout/apply', preset })
  }, [dispatch])

  const requestPicker = useCallback((target: PlaceTarget, at: { x: number; y: number }) => {
    openDialog({ kind: 'arrange', target, at })
  }, [openDialog])
  const isOpen = useCallback((key: string) => findColumnWithTab(columnsRef.current, key) !== null, [columnsRef])
  const endPaneMove = useCallback(() => { setMovingPane(null) }, [])
  const dropPaneOn = useCallback((paneId: string) => {
    if (movingPaneRef.current !== null) dispatch({ type: 'layout/swap', from: movingPaneRef.current, to: paneId })
    setMovingPane(null)
  }, [dispatch])

  const layoutActions: LayoutActions = useMemo(() => ({
    place: placeTarget,
    apply: applyLayout,
    requestPicker,
    isOpen,
    startPaneMove: setMovingPane,
    endPaneMove,
    dropPaneOn,
  }), [placeTarget, applyLayout, requestPicker, isOpen, endPaneMove, dropPaneOn])

  const paneCount = layout.panes.length
  const layoutState: LayoutState = useMemo(() => ({
    preset: layout.preset,
    paneCount,
    movingPane,
  }), [layout.preset, paneCount, movingPane])

  /** The window-layout button shown at the top-right pane; one element, stable across renders. */
  const layoutMenuButton = useMemo(() => (
    <LayoutMenuButton
      className="session-tab-split"
      testId="window-layout-button"
      title="Layout"
      ariaLabel="Change layout"
      heading="Layout"
      mode="layout"
      onPick={(preset) => { applyLayout(preset) }}
    >
      <LayoutIcon />
    </LayoutMenuButton>
  ), [applyLayout])

  return { layoutActions, layoutState, placeTarget, splitActiveTab, layoutMenuButton }
}
