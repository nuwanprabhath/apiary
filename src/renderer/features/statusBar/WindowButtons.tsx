import { type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppWindowInfo } from '@shared/domain/appWindows'
import { useWindowActivity } from '../../state/activeTabsStore'
import { bringWindowToFront, useAppWindowPreview, useAppWindows, watchAppWindowPreview } from '../../state/appWindowsStore'
import { remoteHost, windowNumber } from '../../state/windowParams'
import { HOVER_DELAY_MS } from '../../ui/HoverCard'

type Activity = 'running' | 'waiting' | null

const ACTIVITY_TEXT: Record<'running' | 'waiting' | 'idle', string> = {
  running: 'Claude is working',
  waiting: 'Waiting for you',
  idle: 'Nothing running',
}

function activityText(activity: Activity, win: AppWindowInfo): string {
  if (win.remoteHost !== null) return `Sessions on ${win.remoteHost}`
  return ACTIVITY_TEXT[activity ?? 'idle']
}

/** The tile above a button while it is hovered: a picture of the window, taken again as it changes. */
function WindowPreview({ win, activity, anchor }: { win: AppWindowInfo; activity: Activity; anchor: DOMRect }): JSX.Element {
  const picture = useAppWindowPreview(win.number)
  useEffect(() => watchAppWindowPreview(win.number), [win.number])
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PREVIEW_CARD_WIDTH - 8))
  return createPortal(
    <div
      className="window-preview"
      data-testid="window-preview"
      data-activity={activity ?? 'idle'}
      role="tooltip"
      style={{ left, bottom: window.innerHeight - anchor.top + 6 }}
    >
      <div className="window-preview-head">
        <span className="window-preview-title">{win.title}</span>
        <span className="window-preview-number">Window {win.number}</span>
      </div>
      <div className="window-preview-picture" data-testid="window-preview-picture">
        {typeof picture === 'string'
          ? <img src={picture} alt="" draggable={false} />
          : <span className="window-preview-none">{win.minimized ? 'Minimised' : picture === null ? 'No picture' : 'Taking a picture…'}</span>}
      </div>
      <div className="window-preview-status" data-testid="window-preview-status">
        <span className="window-preview-dot" aria-hidden="true" />
        {activityText(activity, win)}
      </div>
    </div>,
    document.body,
  )
}

/** Matches `.window-preview`'s width, to keep the tile on screen at the right edge. */
const PREVIEW_CARD_WIDTH = 360

function WindowButton({ win, own }: { win: AppWindowInfo; own: boolean }): JSX.Element {
  const activity = useWindowActivity(win.number, remoteHost() !== null)
  const ref = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<number | null>(null)
  const clear = (): void => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null }
  useEffect(() => clear, [])
  const show = (): void => { setAnchor(ref.current?.getBoundingClientRect() ?? null) }
  const hide = (): void => { clear(); setAnchor(null) }
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="window-button"
        data-testid="window-button"
        data-window={win.number}
        data-glow={activity ?? undefined}
        data-minimized={win.minimized ? 'true' : undefined}
        aria-pressed={own}
        aria-label={`Window ${String(win.number)}: ${win.title}${activity === null ? '' : ` (${ACTIVITY_TEXT[activity]})`}`}
        onClick={() => { hide(); if (!own) bringWindowToFront(win.number) }}
        onMouseEnter={() => { clear(); timer.current = window.setTimeout(show, HOVER_DELAY_MS) }}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <span className="window-button-label">{win.title}</span>
      </button>
      {anchor !== null && <WindowPreview win={win} activity={activity} anchor={anchor} />}
    </>
  )
}

/**
 * One button per Apiary window on this machine, as a taskbar has: the window you are in looks
 * pressed, a click brings another to the front from under whatever covers it, and hovering shows a
 * picture of it. A window whose Claude is working glows; one waiting for you glows the warning
 * colour. Nothing with a single window.
 */
export function WindowButtons(): JSX.Element | null {
  const windows = useAppWindows()
  if (windows.length < 2) return null
  const own = windowNumber()
  return (
    <div className="window-buttons" role="group" aria-label="Apiary windows" data-testid="window-buttons">
      {windows.map((w) => <WindowButton key={w.number} win={w} own={w.number === own} />)}
    </div>
  )
}
