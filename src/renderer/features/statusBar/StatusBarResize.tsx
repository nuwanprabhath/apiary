import { type JSX, type RefObject, useEffect, useRef } from 'react'
import {
  STATUS_BAR_MAX, STATUS_BAR_MIN, STATUS_BAR_PRESETS, type StatusBarTier, TIER_LABEL, clampStatusBarHeight, setStatusBarHeight, tierOf,
} from '../../state/statusBarSize'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { useEscape } from '../../ui/useEscape'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'
import { useResizeDrag } from '../../ui/useResizeDrag'

/** How long resize mode outlives the last drag. */
const RESIZE_IDLE_MS = 1500
const KEY_STEP_PX = 2

/** The bar's own right-click menu: the three presets, resize mode, and a reset when not at the default. */
export function statusBarMenuItems(height: number, resizing: boolean, onResize: () => void): ContextMenuItem[] {
  const tiers: StatusBarTier[] = ['compact', 'comfortable', 'tall']
  return [
    ...tiers.map((tier): ContextMenuItem => ({
      id: tier,
      label: TIER_LABEL[tier],
      checked: height === STATUS_BAR_PRESETS[tier],
      run: () => { setStatusBarHeight(STATUS_BAR_PRESETS[tier]) },
    })),
    { id: 'resize', label: 'Resize by dragging', separator: true, checked: resizing, run: onResize },
    ...(height === STATUS_BAR_MIN ? [] : [{ id: 'reset', label: 'Reset size', run: () => { setStatusBarHeight(STATUS_BAR_MIN) } }]),
  ]
}

/**
 * The bar's top edge while resize mode is on: a separator dragged up to grow the bar, with a tag
 * saying the height while it moves. The height follows the pointer live and is saved on release;
 * the mode ends on Escape, a press outside the bar, or a while after the last drag.
 */
export function StatusBarResizeHandle({ height, bar, onExit }: { height: number; bar: RefObject<HTMLElement | null>; onExit: () => void }): JSX.Element {
  const idle = useRef<number | null>(null)
  const armIdle = (): void => {
    if (idle.current !== null) window.clearTimeout(idle.current)
    idle.current = window.setTimeout(onExit, RESIZE_IDLE_MS)
  }
  useEffect(() => () => { if (idle.current !== null) window.clearTimeout(idle.current) }, [])
  useEscape(onExit)
  useOutsideDismiss(onExit, { inside: [bar] })
  const { dragging, separatorProps } = useResizeDrag({
    axis: 'row',
    value: height,
    min: STATUS_BAR_MIN,
    max: STATUS_BAR_MAX,
    grows: 'back',
    step: KEY_STEP_PX,
    label: 'Status bar height',
    measure: (e, start) => clampStatusBarHeight(start.value - (e.clientY - start.y)),
    onLive: (v) => { setStatusBarHeight(v, false) },
    onEnd: (v) => { setStatusBarHeight(v); armIdle() },
  })
  return (
    <div
      className="status-bar-resize"
      data-testid="status-bar-resize"
      {...separatorProps}
      onDoubleClick={() => { setStatusBarHeight(STATUS_BAR_MIN) }}
    >
      {dragging && (
        <span className="status-bar-resize-tag" data-testid="status-bar-resize-tag">
          {`${String(height)} px · ${TIER_LABEL[tierOf(height)]}`}
        </span>
      )}
    </div>
  )
}
